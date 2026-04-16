import { describe, expect, it, vi } from "vitest";
import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ChapterMeta } from "../models/chapter.js";
import { persistChapterArtifacts } from "../pipeline/chapter-persistence.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createIssue(overrides?: Partial<AuditIssue>): AuditIssue {
  return {
    severity: "warning",
    category: "continuity",
    description: "issue",
    suggestion: "fix",
    ...overrides,
  };
}

function createAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "clean",
    ...overrides,
  };
}

describe("persistChapterArtifacts", () => {
  it("persists truth files, index, drift guidance, and snapshots for reviewable chapters", async () => {
    const saveChapterManuscript = vi.fn().mockResolvedValue(undefined);
    const saveOfficialTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const clearReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveChapterIndex = vi.fn().mockResolvedValue(undefined);
    const markBookActiveIfNeeded = vi.fn().mockResolvedValue(undefined);
    const persistAuditDriftGuidance = vi.fn().mockResolvedValue(undefined);
    const snapshotState = vi.fn().mockResolvedValue(undefined);
    const syncCurrentStateFactHistory = vi.fn().mockResolvedValue(undefined);
    const logSnapshotStage = vi.fn();

    await persistChapterArtifacts({
      chapterNumber: 3,
      chapterTitle: "Chapter Title",
      status: "ready-for-review",
      auditResult: createAuditResult({
        issues: [
          createIssue({ severity: "info", description: "ignore me" }),
          createIssue({ severity: "warning", description: "keep me" }),
          createIssue({ severity: "critical", description: "keep me too" }),
        ],
      }),
      finalWordCount: 888,
      lengthWarnings: ["warn"],
      degradedIssues: [],
      tokenUsage: ZERO_USAGE,
      loadChapterIndex: async () => [] satisfies ReadonlyArray<ChapterMeta>,
      saveChapterManuscript,
      saveOfficialTruthFiles,
      saveReviewStageTruthFiles,
      clearReviewStageTruthFiles,
      saveChapterIndex,
      markBookActiveIfNeeded,
      persistAuditDriftGuidance,
      snapshotState,
      syncCurrentStateFactHistory,
      logSnapshotStage,
      now: () => "2026-04-01T00:00:00.000Z",
    });

    expect(saveChapterManuscript).toHaveBeenCalledTimes(1);
    expect(saveOfficialTruthFiles).toHaveBeenCalledTimes(1);
    expect(saveReviewStageTruthFiles).not.toHaveBeenCalled();
    expect(clearReviewStageTruthFiles).toHaveBeenCalledTimes(1);
    expect(saveChapterIndex).toHaveBeenCalledWith([
      expect.objectContaining({
        number: 3,
        title: "Chapter Title",
        status: "ready-for-review",
        wordCount: 888,
        auditIssues: [
          "[info] continuity: ignore me",
          "[warning] continuity: keep me",
          "[critical] continuity: keep me too",
        ],
        reviewNote: undefined,
        tokenUsage: ZERO_USAGE,
      }),
    ]);
    expect(markBookActiveIfNeeded).toHaveBeenCalledTimes(1);
    expect(persistAuditDriftGuidance).toHaveBeenCalledWith([
      expect.objectContaining({ severity: "warning", description: "keep me" }),
      expect.objectContaining({ severity: "critical", description: "keep me too" }),
    ]);
    expect(logSnapshotStage).toHaveBeenCalledTimes(1);
    expect(snapshotState).toHaveBeenCalledTimes(1);
    expect(syncCurrentStateFactHistory).toHaveBeenCalledTimes(1);
  });

  it("skips truth persistence and snapshots for state-degraded chapters while preserving review note", async () => {
    const saveChapterManuscript = vi.fn().mockResolvedValue(undefined);
    const saveOfficialTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const clearReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveChapterIndex = vi.fn().mockResolvedValue(undefined);
    const markBookActiveIfNeeded = vi.fn().mockResolvedValue(undefined);
    const persistAuditDriftGuidance = vi.fn().mockResolvedValue(undefined);
    const snapshotState = vi.fn().mockResolvedValue(undefined);
    const syncCurrentStateFactHistory = vi.fn().mockResolvedValue(undefined);
    const logSnapshotStage = vi.fn();

    await persistChapterArtifacts({
      chapterNumber: 4,
      chapterTitle: "Degraded Chapter",
      status: "state-degraded",
      auditResult: createAuditResult({
        passed: false,
        issues: [createIssue({ description: "audit issue" })],
        summary: "needs review",
      }),
      finalWordCount: 512,
      lengthWarnings: [],
      degradedIssues: [createIssue({ description: "state mismatch" })],
      tokenUsage: ZERO_USAGE,
      loadChapterIndex: async () => [] satisfies ReadonlyArray<ChapterMeta>,
      saveChapterManuscript,
      saveOfficialTruthFiles,
      saveReviewStageTruthFiles,
      clearReviewStageTruthFiles,
      saveChapterIndex,
      markBookActiveIfNeeded,
      persistAuditDriftGuidance,
      snapshotState,
      syncCurrentStateFactHistory,
      logSnapshotStage,
      now: () => "2026-04-01T00:00:00.000Z",
    });

    expect(saveChapterManuscript).toHaveBeenCalledTimes(1);
    expect(saveOfficialTruthFiles).not.toHaveBeenCalled();
    expect(saveReviewStageTruthFiles).not.toHaveBeenCalled();
    expect(clearReviewStageTruthFiles).toHaveBeenCalledTimes(1);
    expect(saveChapterIndex).toHaveBeenCalledWith([
      expect.objectContaining({
        number: 4,
        title: "Degraded Chapter",
        status: "state-degraded",
        reviewNote: expect.any(String),
      }),
    ]);
    const reviewNote = saveChapterIndex.mock.calls[0]?.[0]?.[0]?.reviewNote as string;
    expect(JSON.parse(reviewNote)).toMatchObject({
      kind: "state-degraded",
      baseStatus: "audit-failed",
      injectedIssues: ["[warning] continuity: state mismatch"],
    });
    expect(persistAuditDriftGuidance).toHaveBeenCalledWith([]);
    expect(logSnapshotStage).not.toHaveBeenCalled();
    expect(snapshotState).not.toHaveBeenCalled();
    expect(syncCurrentStateFactHistory).not.toHaveBeenCalled();
  });

  it("writes audit-failed truth into review staging without advancing official snapshots", async () => {
    const saveChapterManuscript = vi.fn().mockResolvedValue(undefined);
    const saveOfficialTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const clearReviewStageTruthFiles = vi.fn().mockResolvedValue(undefined);
    const saveChapterIndex = vi.fn().mockResolvedValue(undefined);
    const markBookActiveIfNeeded = vi.fn().mockResolvedValue(undefined);
    const persistAuditDriftGuidance = vi.fn().mockResolvedValue(undefined);
    const snapshotState = vi.fn().mockResolvedValue(undefined);
    const syncCurrentStateFactHistory = vi.fn().mockResolvedValue(undefined);
    const logSnapshotStage = vi.fn();

    await persistChapterArtifacts({
      chapterNumber: 5,
      chapterTitle: "Pending Audit",
      status: "audit-failed",
      auditResult: createAuditResult({
        passed: false,
        issues: [createIssue({ description: "still needs work" })],
        summary: "needs revision",
      }),
      finalWordCount: 640,
      lengthWarnings: [],
      degradedIssues: [],
      tokenUsage: ZERO_USAGE,
      loadChapterIndex: async () => [] satisfies ReadonlyArray<ChapterMeta>,
      saveChapterManuscript,
      saveOfficialTruthFiles,
      saveReviewStageTruthFiles,
      clearReviewStageTruthFiles,
      saveChapterIndex,
      markBookActiveIfNeeded,
      persistAuditDriftGuidance,
      snapshotState,
      syncCurrentStateFactHistory,
      logSnapshotStage,
      now: () => "2026-04-01T00:00:00.000Z",
    });

    expect(saveChapterManuscript).toHaveBeenCalledTimes(1);
    expect(saveOfficialTruthFiles).not.toHaveBeenCalled();
    expect(saveReviewStageTruthFiles).toHaveBeenCalledTimes(1);
    expect(clearReviewStageTruthFiles).not.toHaveBeenCalled();
    expect(saveChapterIndex).toHaveBeenCalledWith([
      expect.objectContaining({
        number: 5,
        status: "audit-failed",
        auditIssues: ["[warning] continuity: still needs work"],
      }),
    ]);
    expect(snapshotState).not.toHaveBeenCalled();
    expect(syncCurrentStateFactHistory).not.toHaveBeenCalled();
    expect(logSnapshotStage).not.toHaveBeenCalled();
  });
});
