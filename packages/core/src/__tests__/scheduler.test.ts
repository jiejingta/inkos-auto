import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler, type SchedulerConfig } from "../pipeline/scheduler.js";
import type { BookConfig } from "../models/book.js";

function createConfig(): SchedulerConfig {
  return {
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 1024,
        thinkingBudget: 0, maxTokensCap: null,
      },
    } as SchedulerConfig["client"],
    model: "test-model",
    projectRoot: process.cwd(),
    radarCron: "*/1 * * * *",
    writeCron: "*/1 * * * *",
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 0,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 10,
  };
}

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not start a second write cycle while one is still running", async () => {
    const scheduler = new Scheduler(createConfig());
    let releaseCycle: (() => void) | undefined;
    const blockedCycle = new Promise<void>((resolve) => {
      releaseCycle = resolve;
    });

    const runWriteCycle = vi
      .spyOn(scheduler as unknown as { runWriteCycle: () => Promise<void> }, "runWriteCycle")
      .mockImplementation(async () => {
        if (runWriteCycle.mock.calls.length === 1) {
          return;
        }
        await blockedCycle;
      });
    vi.spyOn(scheduler as unknown as { runRadarScan: () => Promise<void> }, "runRadarScan")
      .mockResolvedValue(undefined);

    await scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runWriteCycle).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runWriteCycle).toHaveBeenCalledTimes(2);

    releaseCycle?.();
    await blockedCycle;
    scheduler.stop();
  });

  it("treats state-degraded chapter results as handled failures", async () => {
    const onChapterComplete = vi.fn();
    const scheduler = new Scheduler({
      ...createConfig(),
      onChapterComplete,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockResolvedValue({
        chapterNumber: 3,
        title: "Broken State",
        wordCount: 2100,
        revised: false,
        status: "state-degraded",
        auditResult: {
          passed: true,
          issues: [{
            severity: "warning",
            category: "state-validation",
            description: "state validation still failed after retry",
            suggestion: "repair state before continuing",
          }],
          summary: "clean",
        },
    });
    const handleAuditFailure = vi.spyOn(
      scheduler as unknown as { handleAuditFailure: (bookId: string, chapterNumber: number, issueCategories?: string[]) => Promise<void> },
      "handleAuditFailure",
    ).mockResolvedValue(undefined);

    const success = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<"approved" | "audit-failed" | "runtime-transient">;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(success).toBe("audit-failed");
    expect(handleAuditFailure).toHaveBeenCalledWith("book-1", 3, ["state-validation"]);
    expect(onChapterComplete).toHaveBeenCalledWith("book-1", 3, "state-degraded");
  });

  it("auto-approves chapters that pass audit in autonomous mode", async () => {
    const onChapterComplete = vi.fn();
    const scheduler = new Scheduler({
      ...createConfig(),
      onChapterComplete,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    const state = (scheduler as unknown as {
      state: {
        loadChapterIndex: (bookId: string) => Promise<unknown>;
      };
    }).state;
    const loadChapterIndex = vi.spyOn(state, "loadChapterIndex")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const approveChapter = vi.spyOn(
      (scheduler as unknown as { pipeline: { approveChapter: (bookId: string, chapterNumber: number) => Promise<unknown> } }).pipeline,
      "approveChapter",
    ).mockResolvedValue({
      chapterNumber: 1,
      promotedReviewStage: false,
    });

    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockResolvedValue({
        chapterNumber: 1,
        title: "Fresh Chapter",
        wordCount: 2100,
        revised: false,
        status: "ready-for-review",
        auditResult: {
          passed: true,
          issues: [],
          summary: "clean",
        },
    });

    const success = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<"approved" | "audit-failed" | "runtime-transient">;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(success).toBe("approved");
    expect(loadChapterIndex).toHaveBeenCalledTimes(1);
    expect(approveChapter).toHaveBeenCalledWith("book-1", 1);
    expect(onChapterComplete).toHaveBeenCalledWith("book-1", 1, "approved");
  });

  it("logs runtime write exceptions before consuming the retry budget", async () => {
    const onError = vi.fn();
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    logger.child.mockReturnValue(logger);

    const scheduler = new Scheduler({
      ...createConfig(),
      logger: logger as unknown as SchedulerConfig["logger"],
      onError,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn((scheduler as unknown as {
      state: {
        loadChapterIndex: (bookId: string) => Promise<unknown>;
      };
    }).state, "loadChapterIndex").mockResolvedValue([]);

    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockRejectedValue(new Error("429 Too Many Requests"));

    const outcome = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<"approved" | "audit-failed" | "runtime-transient">;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(outcome).toBe("runtime-transient");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("book-1 write attempt crashed: 429 Too Many Requests"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("transient runtime error"));
    expect(onError).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({ message: "429 Too Many Requests" }),
    );
    expect((scheduler as unknown as { consecutiveFailures: Map<string, number> }).consecutiveFailures.has("book-1")).toBe(false);
  });

  it("pauses immediately on non-retryable runtime authentication errors", async () => {
    const onError = vi.fn();
    const onPause = vi.fn();
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    logger.child.mockReturnValue(logger);

    const scheduler = new Scheduler({
      ...createConfig(),
      logger: logger as unknown as SchedulerConfig["logger"],
      onError,
      onPause,
    });
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    vi.spyOn((scheduler as unknown as {
      state: {
        loadChapterIndex: (bookId: string) => Promise<unknown>;
      };
    }).state, "loadChapterIndex").mockResolvedValue([]);

    vi.spyOn(
      (scheduler as unknown as { pipeline: { writeNextChapter: (bookId: string, words?: number, temp?: number) => Promise<unknown> } }).pipeline,
      "writeNextChapter",
    ).mockRejectedValue(new Error("API 返回 401 (未授权)。请检查 .env 中的 INKOS_LLM_API_KEY 是否正确。"));

    const outcome = await (
      scheduler as unknown as {
        writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<"approved" | "audit-failed" | "runtime-transient">;
      }
    ).writeOneChapter("book-1", bookConfig);

    expect(outcome).toBe("audit-failed");
    expect(scheduler.isBookPaused("book-1")).toBe(true);
    expect(onPause).toHaveBeenCalledWith(
      "book-1",
      expect.stringContaining("non-retryable runtime error: API 返回 401"),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("runtime failure"));
    expect(onError).toHaveBeenCalledWith(
      "book-1",
      expect.objectContaining({ message: expect.stringContaining("API 返回 401") }),
    );
  });

  it("uses a 20-retry autonomous audit budget by default", () => {
    const scheduler = new Scheduler(createConfig());
    expect((scheduler as unknown as { gates: { maxAuditRetries: number; pauseAfterConsecutiveFailures: number } }).gates)
      .toMatchObject({
        maxAuditRetries: 20,
        pauseAfterConsecutiveFailures: 21,
      });
  });

  it("keeps retrying failed chapters until the retry budget is exhausted", async () => {
    const scheduler = new Scheduler({
      ...createConfig(),
      qualityGates: {
        maxAuditRetries: 3,
        pauseAfterConsecutiveFailures: 4,
        retryTemperatureStep: 0.1,
      },
    });
    const runtime = scheduler as unknown as {
      consecutiveFailures: Map<string, number>;
      running: boolean;
      processBook: (bookId: string, bookConfig: BookConfig) => Promise<void>;
      writeOneChapter: (bookId: string, bookConfig: BookConfig) => Promise<"approved" | "audit-failed" | "runtime-transient">;
    };
    const bookConfig: BookConfig = {
      id: "book-1",
      title: "Book 1",
      platform: "other",
      genre: "other",
      status: "active",
      targetChapters: 10,
      chapterWordCount: 2200,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    const writeOneChapter = vi.spyOn(runtime, "writeOneChapter").mockImplementation(async () => {
      const failures = (runtime.consecutiveFailures.get("book-1") ?? 0) + 1;
      runtime.consecutiveFailures.set("book-1", failures);
      return "audit-failed";
    });

    runtime.running = true;
    await runtime.processBook("book-1", bookConfig);

    expect(writeOneChapter).toHaveBeenCalledTimes(4);
  });

  it("audits and auto-approves pending history before writing the next chapter", async () => {
    const scheduler = new Scheduler(createConfig());
    const state = (scheduler as unknown as {
      state: {
        loadChapterIndex: (bookId: string) => Promise<unknown>;
      };
    }).state;
    vi.spyOn(state, "loadChapterIndex")
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "ready-for-review",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }])
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "ready-for-review",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }])
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "approved",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }]);

    const pipeline = (scheduler as unknown as {
      pipeline: {
        auditDraft: (bookId: string, chapterNumber?: number) => Promise<unknown>;
        reviseDraft: (bookId: string, chapterNumber?: number) => Promise<unknown>;
        approveChapter: (bookId: string, chapterNumber: number) => Promise<unknown>;
      };
    }).pipeline;
    const auditDraft = vi.spyOn(pipeline, "auditDraft").mockResolvedValue({
      chapterNumber: 1,
      passed: true,
      issues: [],
      summary: "clean",
    });
    const reviseDraft = vi.spyOn(pipeline, "reviseDraft");
    const approveChapter = vi.spyOn(pipeline, "approveChapter").mockResolvedValue({
      chapterNumber: 1,
      promotedReviewStage: false,
    });

    const result = await (
      scheduler as unknown as {
        ensureHistoryApproved: (bookId: string) => Promise<{ ready: boolean }>;
      }
    ).ensureHistoryApproved("book-1");

    expect(result.ready).toBe(true);
    expect(auditDraft).toHaveBeenCalledWith("book-1", 1);
    expect(reviseDraft).not.toHaveBeenCalled();
    expect(approveChapter).toHaveBeenCalledWith("book-1", 1);
  });

  it("escalates repeated structural history failures to rewrite mode", async () => {
    const scheduler = new Scheduler(createConfig());
    const runtime = scheduler as unknown as {
      consecutiveFailures: Map<string, number>;
      state: {
        loadChapterIndex: (bookId: string) => Promise<unknown>;
        saveChapterIndex: (bookId: string, index: unknown) => Promise<void>;
      };
      pipeline: {
        auditDraft: (bookId: string, chapterNumber?: number) => Promise<unknown>;
        reviseDraft: (
          bookId: string,
          chapterNumber?: number,
          mode?: string,
          options?: { consecutiveFailures?: number },
        ) => Promise<unknown>;
        approveChapter: (bookId: string, chapterNumber: number) => Promise<unknown>;
      };
    };
    runtime.consecutiveFailures.set("book-1", 4);

    vi.spyOn(runtime.state, "loadChapterIndex")
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "audit-failed",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }])
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "audit-failed",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }])
      .mockResolvedValueOnce([{
        number: 1,
        title: "Ch1",
        status: "approved",
        wordCount: 1800,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }]);
    vi.spyOn(runtime.state, "saveChapterIndex").mockResolvedValue(undefined);

    vi.spyOn(runtime.pipeline, "auditDraft").mockResolvedValue({
      chapterNumber: 1,
      passed: false,
      issues: [{
        severity: "critical",
        category: "大纲偏离检测",
        description: "chapter skipped the planned beat",
        suggestion: "restore the planned beat",
      }],
      summary: "needs rewrite",
    });
    const reviseDraft = vi.spyOn(runtime.pipeline, "reviseDraft").mockResolvedValue({
      chapterNumber: 1,
      wordCount: 1800,
      fixedIssues: ["rewritten"],
      applied: true,
      status: "ready-for-review",
    });
    const approveChapter = vi.spyOn(runtime.pipeline, "approveChapter").mockResolvedValue({
      chapterNumber: 1,
      promotedReviewStage: true,
    });

    const result = await (
      scheduler as unknown as {
        ensureHistoryApproved: (bookId: string) => Promise<{ ready: boolean }>;
      }
    ).ensureHistoryApproved("book-1");

    expect(result.ready).toBe(true);
    expect(reviseDraft).toHaveBeenCalledWith(
      "book-1",
      1,
      "rewrite",
      { consecutiveFailures: 4 },
    );
    expect(approveChapter).toHaveBeenCalledWith("book-1", 1);
  });
});
