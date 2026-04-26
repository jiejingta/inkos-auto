import type { AuditIssue, AuditResult, AuditTruthContext, TruthFileSnapshot } from "../agents/continuity.js";
import type { ReviseMode, ReviseOutput } from "../agents/reviser.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import { resolveRevisionMode } from "./revision-strategy.js";

export interface ChapterReviewCycleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterReviewCycleControlInput {
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
}

export interface ChapterReviewCycleResult {
  readonly finalContent: string;
  readonly finalWordCount: number;
  readonly preAuditNormalizedWordCount: number;
  readonly revised: boolean;
  readonly auditResult: AuditResult;
  readonly totalUsage: ChapterReviewCycleUsage;
  readonly postReviseCount: number;
  readonly normalizeApplied: boolean;
  readonly candidateTruth: TruthFileSnapshot;
}

function buildTruthSnapshot(
  output: Pick<WriteChapterOutput, "updatedState" | "updatedLedger" | "updatedHooks">,
): TruthFileSnapshot {
  return {
    currentState: output.updatedState,
    ledger: output.updatedLedger,
    hooks: output.updatedHooks,
  };
}

function countActionableIssues(issues: ReadonlyArray<AuditIssue>): number {
  return issues.filter((issue) => issue.severity === "warning" || issue.severity === "critical").length;
}

function countCriticalIssues(issues: ReadonlyArray<AuditIssue>): number {
  return issues.filter((issue) => issue.severity === "critical").length;
}

function shouldApplyAutoRevision(params: {
  readonly previousAudit: AuditResult;
  readonly candidateAudit: AuditResult;
  readonly previousAITellCount: number;
  readonly candidateAITellCount: number;
}): boolean {
  const previousBlocking = countActionableIssues(params.previousAudit.issues);
  const candidateBlocking = countActionableIssues(params.candidateAudit.issues);
  const previousCritical = countCriticalIssues(params.previousAudit.issues);
  const candidateCritical = countCriticalIssues(params.candidateAudit.issues);

  const didNotWorsen = candidateBlocking <= previousBlocking
    && candidateCritical <= previousCritical
    && params.candidateAITellCount <= params.previousAITellCount;
  const improved = (!params.previousAudit.passed && params.candidateAudit.passed)
    || candidateBlocking < previousBlocking
    || candidateCritical < previousCritical
    || params.candidateAITellCount < params.previousAITellCount;

  return didNotWorsen && improved;
}

export async function runChapterReviewCycle(params: {
  readonly book: Pick<{ genre: string }, "genre">;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly initialOutput: Pick<
    WriteChapterOutput,
    "title" | "content" | "wordCount" | "postWriteErrors" | "updatedState" | "updatedLedger" | "updatedHooks"
  >;
  readonly reducedControlInput?: ChapterReviewCycleControlInput;
  readonly lengthSpec: LengthSpec;
  readonly initialUsage: ChapterReviewCycleUsage;
  readonly resettleChapterState: (
    chapterContent: string,
  ) => Promise<
    Pick<WriteChapterOutput, "content" | "wordCount" | "updatedState" | "updatedLedger" | "updatedHooks" | "tokenUsage">
  >;
  readonly createReviser: () => {
    reviseChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      issues: ReadonlyArray<AuditIssue>,
      mode: ReviseMode,
      genre?: string,
      options?: {
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
        lengthSpec?: LengthSpec;
        truthContext?: AuditTruthContext;
      },
    ) => Promise<ReviseOutput>;
  };
  readonly auditor: {
    auditChapter: (
      bookDir: string,
      chapterContent: string,
      chapterNumber: number,
      genre?: string,
      options?: {
        temperature?: number;
        chapterIntent?: string;
        contextPackage?: ContextPackage;
        ruleStack?: RuleStack;
        truthContext?: {
          official?: TruthFileSnapshot;
          candidate?: TruthFileSnapshot;
        };
      },
    ) => Promise<AuditResult>;
  };
  readonly normalizeDraftLengthIfNeeded: (chapterContent: string) => Promise<{
    content: string;
    wordCount: number;
    applied: boolean;
    tokenUsage?: ChapterReviewCycleUsage;
  }>;
  readonly assertChapterContentNotEmpty: (content: string, stage: string) => void;
  readonly addUsage: (
    left: ChapterReviewCycleUsage,
    right?: ChapterReviewCycleUsage,
  ) => ChapterReviewCycleUsage;
  readonly restoreLostAuditIssues: (previous: AuditResult, next: AuditResult) => AuditResult;
  readonly analyzeAITells: (content: string) => { issues: ReadonlyArray<AuditIssue> };
  readonly analyzeSensitiveWords: (content: string) => {
    found: ReadonlyArray<{ severity: string }>;
    issues: ReadonlyArray<AuditIssue>;
  };
  readonly logWarn: (message: { zh: string; en: string }) => void;
  readonly logStage: (message: { zh: string; en: string }) => void;
}): Promise<ChapterReviewCycleResult> {
  let totalUsage = params.initialUsage;
  let postReviseCount = 0;
  let normalizeApplied = false;
  let finalContent = params.initialOutput.content;
  let finalWordCount = params.initialOutput.wordCount;
  let revised = false;
  let candidateTruth = buildTruthSnapshot(params.initialOutput);
  let candidateTruthContent = params.initialOutput.content;

  const buildAuditOptions = (temperature?: number) => ({
    ...(params.reducedControlInput ?? {}),
    ...(temperature === undefined ? {} : { temperature }),
    truthContext: {
      candidate: candidateTruth,
    },
  });
  const buildReviserOptions = () => ({
    ...(params.reducedControlInput ?? {}),
    lengthSpec: params.lengthSpec,
    truthContext: {
      candidate: candidateTruth,
    },
  });
  const settleTruthForContent = async (chapterContent: string): Promise<TruthFileSnapshot> => {
    if (chapterContent === candidateTruthContent) {
      return candidateTruth;
    }
    const resettled = await params.resettleChapterState(chapterContent);
    totalUsage = params.addUsage(totalUsage, resettled.tokenUsage);
    return buildTruthSnapshot(resettled);
  };
  const refreshCandidateTruth = async (chapterContent: string): Promise<void> => {
    if (chapterContent === candidateTruthContent) {
      return;
    }
    candidateTruth = await settleTruthForContent(chapterContent);
    candidateTruthContent = chapterContent;
  };

  if (params.initialOutput.postWriteErrors.length > 0) {
    params.logWarn({
      zh: `检测到 ${params.initialOutput.postWriteErrors.length} 个后写错误，审计前触发 spot-fix 修补`,
      en: `${params.initialOutput.postWriteErrors.length} post-write errors detected, triggering spot-fix before audit`,
    });
    const reviser = params.createReviser();
    const spotFixIssues = params.initialOutput.postWriteErrors.map((violation) => ({
      severity: "critical" as const,
      category: violation.rule,
      description: violation.description,
      suggestion: violation.suggestion,
    }));
    const fixResult = await reviser.reviseChapter(
      params.bookDir,
      finalContent,
      params.chapterNumber,
      spotFixIssues,
      "spot-fix",
      params.book.genre,
      buildReviserOptions(),
    );
    totalUsage = params.addUsage(totalUsage, fixResult.tokenUsage);
    if (fixResult.revisedContent.length > 0) {
      finalContent = fixResult.revisedContent;
      finalWordCount = fixResult.wordCount;
      revised = true;
    }
  }

  const normalizedBeforeAudit = await params.normalizeDraftLengthIfNeeded(finalContent);
  totalUsage = params.addUsage(totalUsage, normalizedBeforeAudit.tokenUsage);
  finalContent = normalizedBeforeAudit.content;
  finalWordCount = normalizedBeforeAudit.wordCount;
  normalizeApplied = normalizeApplied || normalizedBeforeAudit.applied;
  params.assertChapterContentNotEmpty(finalContent, "draft generation");
  await refreshCandidateTruth(finalContent);

  params.logStage({ zh: "审计草稿", en: "auditing draft" });
  const llmAudit = await params.auditor.auditChapter(
    params.bookDir,
    finalContent,
    params.chapterNumber,
    params.book.genre,
    buildAuditOptions(),
  );
  totalUsage = params.addUsage(totalUsage, llmAudit.tokenUsage);
  const aiTellsResult = params.analyzeAITells(finalContent);
  const sensitiveWriteResult = params.analyzeSensitiveWords(finalContent);
  const hasBlockedWriteWords = sensitiveWriteResult.found.some((item) => item.severity === "block");
  let auditResult: AuditResult = {
    passed: hasBlockedWriteWords ? false : llmAudit.passed,
    issues: [...llmAudit.issues, ...aiTellsResult.issues, ...sensitiveWriteResult.issues],
    summary: llmAudit.summary,
  };

  if (!auditResult.passed) {
    const blockingIssues = auditResult.issues.filter(
      (issue) => issue.severity === "critical" || issue.severity === "warning",
    );
    if (blockingIssues.length > 0) {
      const reviser = params.createReviser();
      const revisionStrategy = resolveRevisionMode({ issues: blockingIssues });
      if (revisionStrategy.mode !== "spot-fix") {
        params.logWarn({
          zh: `审计命中结构性问题，自动将修订模式升级为 ${revisionStrategy.mode}：${revisionStrategy.rationale}`,
          en: `Structural audit issues detected, escalating auto-revision to ${revisionStrategy.mode}: ${revisionStrategy.rationale}`,
        });
      }
      params.logStage({ zh: "自动修复阻断问题", en: "auto-revising blocking issues" });
      const reviseOutput = await reviser.reviseChapter(
        params.bookDir,
        finalContent,
        params.chapterNumber,
        blockingIssues,
        revisionStrategy.mode,
        params.book.genre,
        buildReviserOptions(),
      );
      totalUsage = params.addUsage(totalUsage, reviseOutput.tokenUsage);

      if (reviseOutput.revisedContent.length > 0) {
        const normalizedRevision = await params.normalizeDraftLengthIfNeeded(reviseOutput.revisedContent);
        totalUsage = params.addUsage(totalUsage, normalizedRevision.tokenUsage);

        const preMarkers = params.analyzeAITells(finalContent);
        const postMarkers = params.analyzeAITells(normalizedRevision.content);
        if (postMarkers.issues.length > preMarkers.issues.length) {
          params.logWarn({
            zh: "自动修订被拒绝：修后 AI 味问题增加，保留原稿。",
            en: "Auto-revision rejected: AI-tell issues increased; keeping original draft.",
          });
        } else {
          params.assertChapterContentNotEmpty(normalizedRevision.content, "revision");
          const revisionTruth = await settleTruthForContent(normalizedRevision.content);
          const reAudit = await params.auditor.auditChapter(
            params.bookDir,
            normalizedRevision.content,
            params.chapterNumber,
            params.book.genre,
            {
              ...(params.reducedControlInput ?? {}),
              temperature: 0,
              truthContext: {
                candidate: revisionTruth,
              },
            },
          );
          totalUsage = params.addUsage(totalUsage, reAudit.tokenUsage);
          const reSensitive = params.analyzeSensitiveWords(normalizedRevision.content);
          const reHasBlocked = reSensitive.found.some((item) => item.severity === "block");
          const candidateAudit = params.restoreLostAuditIssues(auditResult, {
            passed: reHasBlocked ? false : reAudit.passed,
            issues: [...reAudit.issues, ...postMarkers.issues, ...reSensitive.issues],
            summary: reAudit.summary,
          });

          if (shouldApplyAutoRevision({
            previousAudit: auditResult,
            candidateAudit,
            previousAITellCount: preMarkers.issues.length,
            candidateAITellCount: postMarkers.issues.length,
          })) {
            postReviseCount = normalizedRevision.wordCount;
            normalizeApplied = normalizeApplied || normalizedRevision.applied;
            candidateTruth = revisionTruth;
            candidateTruthContent = normalizedRevision.content;
            auditResult = candidateAudit;
            finalContent = normalizedRevision.content;
            finalWordCount = normalizedRevision.wordCount;
            revised = true;
          } else {
            params.logWarn({
              zh: "自动修订被拒绝：修后审计未改善或阻断问题变多，保留原稿。",
              en: "Auto-revision rejected: post-revision audit did not improve or introduced more blockers; keeping original draft.",
            });
          }
        }

      }
    }
  }

  return {
    finalContent,
    finalWordCount,
    preAuditNormalizedWordCount: normalizedBeforeAudit.wordCount,
    revised,
    auditResult,
    totalUsage,
    postReviseCount,
    normalizeApplied,
    candidateTruth,
  };
}
