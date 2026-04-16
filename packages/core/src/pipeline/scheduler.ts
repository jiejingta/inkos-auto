import { PipelineRunner } from "./runner.js";
import type { PipelineConfig } from "./runner.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { QualityGates, DetectionConfig } from "../models/project.js";
import { dispatchWebhookEvent } from "../notify/dispatcher.js";
import { detectChapter, detectAndRewrite } from "./detection-runner.js";
import { resolveRevisionMode } from "./revision-strategy.js";
import type { Logger } from "../utils/logger.js";

export interface SchedulerConfig extends PipelineConfig {
  readonly radarCron: string;
  readonly writeCron: string;
  readonly maxConcurrentBooks: number;
  readonly chaptersPerCycle: number;
  readonly retryDelayMs: number;
  readonly cooldownAfterChapterMs: number;
  readonly maxChaptersPerDay: number;
  readonly qualityGates?: QualityGates;
  readonly detection?: DetectionConfig;
  readonly onChapterComplete?: (bookId: string, chapter: number, status: string) => void;
  readonly onError?: (bookId: string, error: Error) => void;
  readonly onPause?: (bookId: string, reason: string) => void;
}

interface ScheduledTask {
  readonly name: string;
  readonly intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

interface ApprovalGuardResult {
  readonly ready: boolean;
  readonly chapterNumber?: number;
  readonly issueCategories?: ReadonlyArray<string>;
  readonly reason?: string;
}

const AUTONOMOUS_APPROVED_STATUSES = new Set(["approved", "published", "imported"]);

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isNonRetryableRuntimeError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("api 返回 401")
    || message.includes("api 返回 403")
    || message.includes("could not resolve authentication method")
    || message.includes("model_not_found")
    || message.includes("model not found")
    || message.includes("baseurl 地址不正确")
    || message.includes("inkos_llm_api_key not set")
  );
}

function summarizePauseReason(error: Error): string {
  const firstLine = error.message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? error.message;
}

function formatErrorForLog(error: Error): string {
  const stack = error.stack?.trim();
  if (!stack) {
    return error.message;
  }

  const lines = stack.split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  const headline = `${error.name}: ${error.message}`;
  const detailLines = firstLine === headline || firstLine === error.message
    ? lines.slice(1)
    : lines;
  const detail = detailLines.join("\n").trim();

  return detail.length > 0
    ? `${error.message}\n${detail}`
    : error.message;
}

export class Scheduler {
  private readonly pipeline: PipelineRunner;
  private readonly state: StateManager;
  private readonly config: SchedulerConfig;
  private tasks: ScheduledTask[] = [];
  private running = false;
  private writeCycleInFlight: Promise<void> | null = null;
  private radarScanInFlight: Promise<void> | null = null;

  // Quality gate tracking (per book)
  private consecutiveFailures = new Map<string, number>();
  private pausedBooks = new Set<string>();
  // Failure clustering: bookId → (dimension → count)
  private failureDimensions = new Map<string, Map<string, number>>();
  // Daily chapter counter: "YYYY-MM-DD" → count
  private dailyChapterCount = new Map<string, number>();

  private readonly log?: Logger;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.pipeline = new PipelineRunner(config);
    this.state = new StateManager(config.projectRoot);
    this.log = config.logger?.child("scheduler");
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Run write cycle immediately on start, then schedule
    await this.triggerWriteCycle();

    // Schedule recurring write cycle
    const writeCycleMs = this.cronToMs(this.config.writeCron);
    const writeTask: ScheduledTask = {
      name: "write-cycle",
      intervalMs: writeCycleMs,
    };
    writeTask.timer = setInterval(() => {
      this.triggerWriteCycle().catch((e) => {
        const error = normalizeError(e);
        this.log?.error(`Write cycle crashed: ${formatErrorForLog(error)}`);
        this.config.onError?.("scheduler", error);
      });
    }, writeCycleMs);
    this.tasks.push(writeTask);

    // Schedule radar scan
    const radarMs = this.cronToMs(this.config.radarCron);
    const radarTask: ScheduledTask = {
      name: "radar-scan",
      intervalMs: radarMs,
    };
    radarTask.timer = setInterval(() => {
      this.triggerRadarScan().catch((e) => {
        const error = normalizeError(e);
        this.log?.error(`Radar scan crashed: ${formatErrorForLog(error)}`);
        this.config.onError?.("radar", error);
      });
    }, radarMs);
    this.tasks.push(radarTask);
  }

  stop(): void {
    this.running = false;
    for (const task of this.tasks) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks = [];
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async triggerWriteCycle(): Promise<void> {
    if (this.writeCycleInFlight) {
      this.log?.warn("Write cycle still running, skipping overlapping tick");
      return;
    }

    const cycle = this.runWriteCycle().finally(() => {
      if (this.writeCycleInFlight === cycle) {
        this.writeCycleInFlight = null;
      }
    });
    this.writeCycleInFlight = cycle;
    await cycle;
  }

  private async triggerRadarScan(): Promise<void> {
    if (this.radarScanInFlight) {
      this.log?.warn("Radar scan still running, skipping overlapping tick");
      return;
    }

    const scan = this.runRadarScan().finally(() => {
      if (this.radarScanInFlight === scan) {
        this.radarScanInFlight = null;
      }
    });
    this.radarScanInFlight = scan;
    await scan;
  }

  /** Resume a paused book. */
  resumeBook(bookId: string): void {
    this.pausedBooks.delete(bookId);
    this.consecutiveFailures.delete(bookId);
    this.failureDimensions.delete(bookId);
  }

  /** Check if a book is paused. */
  isBookPaused(bookId: string): boolean {
    return this.pausedBooks.has(bookId);
  }

  private get gates(): QualityGates {
    return this.config.qualityGates ?? {
      maxAuditRetries: 20,
      pauseAfterConsecutiveFailures: 21,
      retryTemperatureStep: 0.1,
    };
  }

  /** Check if daily cap is reached across all books. */
  private isDailyCapReached(): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    return count >= this.config.maxChaptersPerDay;
  }

  /** Increment daily chapter counter. */
  private recordChapterWritten(): void {
    const today = new Date().toISOString().slice(0, 10);
    const count = this.dailyChapterCount.get(today) ?? 0;
    this.dailyChapterCount.set(today, count + 1);

    // Clean up old dates (keep only today)
    for (const key of this.dailyChapterCount.keys()) {
      if (key !== today) this.dailyChapterCount.delete(key);
    }
  }

  private async runWriteCycle(): Promise<void> {
    if (this.isDailyCapReached()) {
      this.log?.info(`Daily cap reached (${this.config.maxChaptersPerDay}), skipping cycle`);
      return;
    }

    const bookIds = await this.state.listBooks();

    const activeBooks: Array<{ readonly id: string; readonly config: BookConfig }> = [];
    for (const id of bookIds) {
      if (this.pausedBooks.has(id)) continue;
      const config = await this.state.loadBookConfig(id);
      if (config.status === "active" || config.status === "outlining") {
        activeBooks.push({ id, config });
      }
    }

    const booksToWrite = activeBooks.slice(0, this.config.maxConcurrentBooks);

    // Parallel book processing
    await Promise.all(
      booksToWrite.map((book) => this.processBook(book.id, book.config)),
    );
  }

  /** Process a single book: write chaptersPerCycle chapters with retry + cooldown. */
  private async processBook(bookId: string, bookConfig: BookConfig): Promise<void> {
    for (let i = 0; i < this.config.chaptersPerCycle; i++) {
      if (!this.running) return;
      if (this.isDailyCapReached()) return;
      if (this.pausedBooks.has(bookId)) return;

      // Cooldown between chapters (skip for the first one)
      if (i > 0 && this.config.cooldownAfterChapterMs > 0) {
        await this.sleep(this.config.cooldownAfterChapterMs);
      }

      let success = false;
      while (this.running && !this.isDailyCapReached() && !this.pausedBooks.has(bookId)) {
        success = await this.writeOneChapter(bookId, bookConfig);
        if (success) {
          break;
        }

        const failures = this.consecutiveFailures.get(bookId) ?? 0;
        if (failures > this.gates.maxAuditRetries || this.pausedBooks.has(bookId)) {
          return;
        }

        if (this.config.retryDelayMs > 0) {
          this.log?.warn(`${bookId} retrying in ${this.config.retryDelayMs}ms`);
          await this.sleep(this.config.retryDelayMs);
        }
      }

      if (!success) {
        return;
      }
    }
  }

  /** Write one chapter for a book. Returns true if approved. */
  private async writeOneChapter(bookId: string, bookConfig: BookConfig): Promise<boolean> {
    try {
      const historyGate = await this.ensureHistoryApproved(bookId);
      if (!historyGate.ready) {
        this.log?.warn(historyGate.reason ?? `${bookId} still has chapters waiting for autonomous approval`);
        await this.handleAuditFailure(
          bookId,
          historyGate.chapterNumber ?? 0,
          historyGate.issueCategories ?? [],
        );
        return false;
      }

      // Compute temperature override: base 0.7 + failures * step
      const failures = this.consecutiveFailures.get(bookId) ?? 0;
      const tempOverride = failures > 0
        ? Math.min(1.2, 0.7 + failures * this.gates.retryTemperatureStep)
        : undefined;

      const result = await this.pipeline.writeNextChapter(bookId, undefined, tempOverride);

      if (result.status === "ready-for-review") {
        this.consecutiveFailures.delete(bookId);

        // Auto-detection loop after successful audit
        if (this.config.detection?.enabled) {
          await this.runDetection(bookId, bookConfig, result.chapterNumber);
        }

        await this.approveChapter(bookId, result.chapterNumber);
        this.recordChapterWritten();
        this.config.onChapterComplete?.(bookId, result.chapterNumber, "approved");
        return true;
      }

      // Audit failed — apply quality gates
      const issueCategories = result.auditResult.issues.map((i) => i.category);
      await this.handleAuditFailure(bookId, result.chapterNumber, issueCategories);
      this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
      return false;
    } catch (e) {
      const error = normalizeError(e);
      this.log?.error(`${bookId} write attempt crashed: ${formatErrorForLog(error)}`);
      this.config.onError?.(bookId, error);
      if (isNonRetryableRuntimeError(error)) {
        await this.pauseBookImmediately(
          bookId,
          `non-retryable runtime error: ${summarizePauseReason(error)}`,
          0,
        );
        return false;
      }
      await this.handleRuntimeFailure(bookId, 0);
      return false;
    }
  }

  private async runDetection(
    bookId: string,
    bookConfig: BookConfig,
    chapterNumber: number,
  ): Promise<void> {
    if (!this.config.detection) return;
    try {
      const bookDir = this.state.bookDir(bookId);
      const chapterContent = await this.readChapterContent(bookDir, chapterNumber);
      const detResult = await detectChapter(
        this.config.detection,
        chapterContent,
        chapterNumber,
      );
      if (!detResult.passed && this.config.detection.autoRewrite) {
        await detectAndRewrite(
          this.config.detection,
          { client: this.config.client, model: this.config.model, projectRoot: this.config.projectRoot },
          bookDir,
          chapterContent,
          chapterNumber,
          bookConfig.genre,
        );
      }
    } catch (e) {
      const error = normalizeError(e);
      this.log?.error(`${bookId} detection failed: ${formatErrorForLog(error)}`);
      this.config.onError?.(bookId, error);
    }
  }

  private async ensureHistoryApproved(bookId: string): Promise<ApprovalGuardResult> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const index = [...await this.state.loadChapterIndex(bookId)]
        .sort((left, right) => left.number - right.number);
      const blockingChapter = index.find((chapter) => !AUTONOMOUS_APPROVED_STATUSES.has(chapter.status));
      if (!blockingChapter) {
        return { ready: true };
      }

      if (blockingChapter.status === "state-degraded") {
        return {
          ready: false,
          chapterNumber: blockingChapter.number,
          issueCategories: ["state-validation"],
          reason: `${bookId} chapter ${blockingChapter.number} is state-degraded and must be repaired before autonomous writing can continue`,
        };
      }

      const auditResult = await this.pipeline.auditDraft(bookId, blockingChapter.number);
      if (auditResult.passed) {
        await this.approveChapter(bookId, blockingChapter.number);
        continue;
      }

      const consecutiveFailures = this.consecutiveFailures.get(bookId) ?? 0;
      const revisionStrategy = resolveRevisionMode({
        requestedMode: "spot-fix",
        issues: auditResult.issues,
        consecutiveFailures,
      });
      if (revisionStrategy.mode !== "spot-fix") {
        this.log?.warn(
          `${bookId} chapter ${blockingChapter.number} revision escalated to ${revisionStrategy.mode}: ${revisionStrategy.rationale}`,
        );
      }
      const reviseResult = await this.pipeline.reviseDraft(
        bookId,
        blockingChapter.number,
        revisionStrategy.mode,
        { consecutiveFailures },
      );
      if (reviseResult.status === "ready-for-review") {
        await this.approveChapter(bookId, blockingChapter.number);
        continue;
      }

      return {
        ready: false,
        chapterNumber: blockingChapter.number,
        issueCategories: auditResult.issues.map((issue) => issue.category),
        reason: `${bookId} chapter ${blockingChapter.number} still failed audit after autonomous revision`,
      };
    }

    return {
      ready: false,
      reason: `${bookId} hit the autonomous approval safety limit while reconciling previous chapters`,
    };
  }

  private async approveChapter(bookId: string, chapterNumber: number): Promise<void> {
    const index = [...await this.state.loadChapterIndex(bookId)];
    const chapterIndex = index.findIndex((chapter) => chapter.number === chapterNumber);
    if (chapterIndex < 0) {
      throw new Error(`Chapter ${chapterNumber} not found in "${bookId}"`);
    }

    const target = index[chapterIndex]!;
    if (target.status === "approved") {
      return;
    }

    index[chapterIndex] = {
      ...target,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    await this.state.saveChapterIndex(bookId, index);
    this.log?.info(`${bookId} chapter ${chapterNumber} auto-approved for autonomous mode`);
  }

  private async handleAuditFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string> = [],
  ): Promise<void> {
    await this.recordFailure(bookId, chapterNumber, issueCategories, "audit");
  }

  private async handleRuntimeFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string> = [],
  ): Promise<void> {
    await this.recordFailure(bookId, chapterNumber, issueCategories, "runtime");
  }

  private async recordFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string>,
    kind: "audit" | "runtime",
  ): Promise<void> {
    const failures = (this.consecutiveFailures.get(bookId) ?? 0) + 1;
    this.consecutiveFailures.set(bookId, failures);

    // Track failure dimensions for clustering
    if (issueCategories.length > 0) {
      const existing = this.failureDimensions.get(bookId);
      const dimMap = existing ? new Map(existing) : new Map<string, number>();
      for (const cat of issueCategories) {
        dimMap.set(cat, (dimMap.get(cat) ?? 0) + 1);
      }
      this.failureDimensions.set(bookId, dimMap);

      // Check for dimension clustering (any dimension with >=3 failures)
      for (const [dimension, count] of dimMap) {
        if (count >= 3) {
          await this.emitDiagnosticAlert(bookId, chapterNumber, dimension, count);
        }
      }
    }

    const gates = this.gates;
    const failureLabel = kind === "runtime" ? "runtime failure" : "audit failed";

    if (failures <= gates.maxAuditRetries) {
      this.log?.warn(`${bookId} ${failureLabel} (${failures}/${gates.maxAuditRetries}), will retry`);
      return;
    }

    // Check if we should pause
    if (failures >= gates.pauseAfterConsecutiveFailures) {
      const reason = `${failures} consecutive ${failureLabel}s (threshold: ${gates.pauseAfterConsecutiveFailures})`;
      await this.pauseBookImmediately(bookId, reason, chapterNumber, failures);
    }
  }

  private async pauseBookImmediately(
    bookId: string,
    reason: string,
    chapterNumber: number,
    consecutiveFailures?: number,
  ): Promise<void> {
    this.pausedBooks.add(bookId);
    this.log?.error(`${bookId} PAUSED: ${reason}`);
    this.config.onPause?.(bookId, reason);

    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      await dispatchWebhookEvent(this.config.notifyChannels, {
        event: "pipeline-error",
        bookId,
        chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
        timestamp: new Date().toISOString(),
        data: {
          reason,
          ...(consecutiveFailures === undefined ? {} : { consecutiveFailures }),
        },
      });
    }
  }

  private async runRadarScan(): Promise<void> {
    try {
      await this.pipeline.runRadar();
    } catch (e) {
      const error = normalizeError(e);
      this.log?.error(`Radar scan failed: ${formatErrorForLog(error)}`);
      this.config.onError?.("radar", error);
    }
  }

  private async emitDiagnosticAlert(
    bookId: string,
    chapterNumber: number,
    dimension: string,
    count: number,
  ): Promise<void> {
    this.log?.warn(`DIAGNOSTIC: ${bookId} has ${count} failures in dimension "${dimension}"`);

    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      await dispatchWebhookEvent(this.config.notifyChannels, {
        event: "diagnostic-alert",
        bookId,
        chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
        timestamp: new Date().toISOString(),
        data: { dimension, failureCount: count },
      });
    }
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  private cronToMs(cron: string): number {
    const parts = cron.split(" ");
    if (parts.length < 5) return 24 * 60 * 60 * 1000;

    const minute = parts[0]!;
    const hour = parts[1]!;

    // "*/N * * * *" → every N minutes
    if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2), 10);
      return interval * 60 * 1000;
    }

    // "0 */N * * *" → every N hours
    if (hour.startsWith("*/")) {
      const interval = parseInt(hour.slice(2), 10);
      return interval * 60 * 60 * 1000;
    }

    // Fixed time → treat as daily
    return 24 * 60 * 60 * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
