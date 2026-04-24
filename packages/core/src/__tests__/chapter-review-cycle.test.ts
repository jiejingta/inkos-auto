import { describe, expect, it, vi } from "vitest";
import { runChapterReviewCycle } from "../pipeline/chapter-review-cycle.js";
import type { AuditResult, AuditIssue } from "../agents/continuity.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { PostWriteViolation } from "../agents/post-write-validator.js";

const LENGTH_SPEC: LengthSpec = {
  target: 220,
  softMin: 190,
  softMax: 250,
  hardMin: 160,
  hardMax: 280,
  countingMode: "zh_chars",
  normalizeMode: "none",
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createAuditResult(overrides?: Partial<AuditResult>): AuditResult {
  return {
    passed: true,
    issues: [],
    summary: "clean",
    ...overrides,
  };
}

function createInitialOutput(
  overrides?: Partial<{
    title: string;
    content: string;
    wordCount: number;
    postWriteErrors: ReadonlyArray<PostWriteViolation>;
    updatedState: string;
    updatedLedger: string;
    updatedHooks: string;
  }>,
) {
  return {
    title: "Draft Title",
    content: "raw draft",
    wordCount: 9,
    postWriteErrors: [] as ReadonlyArray<PostWriteViolation>,
    updatedState: "state: raw",
    updatedLedger: "ledger: raw",
    updatedHooks: "hooks: raw",
    ...overrides,
  };
}

function createSettledOutput(
  content: string,
  overrides?: Partial<{
    updatedState: string;
    updatedLedger: string;
    updatedHooks: string;
  }>,
) {
  return {
    content,
    wordCount: content.length,
    updatedState: `state: ${content}`,
    updatedLedger: `ledger: ${content}`,
    updatedHooks: `hooks: ${content}`,
    tokenUsage: ZERO_USAGE,
    ...overrides,
  };
}

describe("runChapterReviewCycle", () => {
  it("applies post-write spot-fix before the first audit pass", async () => {
    const auditChapter = vi.fn()
      .mockResolvedValue(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "fixed draft",
      wordCount: 10,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValue({
        content: "fixed draft",
        wordCount: 10,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const resettleChapterState = vi.fn().mockResolvedValue(
      createSettledOutput("fixed draft"),
    );

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: createInitialOutput({
        postWriteErrors: [{
          rule: "paragraph-shape",
          description: "too fragmented",
          suggestion: "merge short fragments",
          severity: "error",
        }],
      }),
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      resettleChapterState,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "fixed draft",
      1,
      "xuanhuan",
      {
        truthContext: {
          candidate: {
            currentState: "state: fixed draft",
            ledger: "ledger: fixed draft",
            hooks: "hooks: fixed draft",
          },
        },
      },
    );
    expect(resettleChapterState).toHaveBeenCalledTimes(1);
    expect(resettleChapterState).toHaveBeenCalledWith("fixed draft");
    expect(result.finalContent).toBe("fixed draft");
    expect(result.revised).toBe(true);
  });

  it("drops auto-revision when it increases AI tells and re-audits the original draft", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "critical",
        category: "continuity",
        description: "broken continuity",
        suggestion: "fix it",
      }],
      summary: "bad",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "rewritten draft",
      wordCount: 15,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "rewritten draft",
        wordCount: 15,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const analyzeAITells = vi.fn((content: string) => ({
      issues: content === "rewritten draft"
        ? [{ severity: "warning", category: "ai", description: "more ai", suggestion: "reduce" } satisfies AuditIssue]
        : [],
    }));
    const resettleChapterState = vi.fn().mockResolvedValue(
      createSettledOutput("rewritten draft"),
    );

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: createInitialOutput({
        content: "original draft",
        wordCount: 13,
        updatedState: "state: original",
        updatedLedger: "ledger: original",
        updatedHooks: "hooks: original",
      }),
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      resettleChapterState,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells,
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(auditChapter).toHaveBeenNthCalledWith(
      1,
      "/tmp/book",
      "original draft",
      1,
      "xuanhuan",
      {
        truthContext: {
          candidate: {
            currentState: "state: original",
            ledger: "ledger: original",
            hooks: "hooks: original",
          },
        },
      },
    );
    expect(auditChapter).toHaveBeenNthCalledWith(
      2,
      "/tmp/book",
      "original draft",
      1,
      "xuanhuan",
      {
        temperature: 0,
        truthContext: {
          candidate: {
            currentState: "state: original",
            ledger: "ledger: original",
            hooks: "hooks: original",
          },
        },
      },
    );
    expect(resettleChapterState).not.toHaveBeenCalled();
    expect(result.finalContent).toBe("original draft");
    expect(result.revised).toBe(false);
  });

  it("auto-revises blocking warning-only audits before persisting failure", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [{
        severity: "warning",
        category: "Timeline Check",
        description: "the sequence of events still feels misaligned",
        suggestion: "repair the sequence",
      }],
      summary: "needs revision",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "repaired draft",
      wordCount: 12,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "repaired draft",
        wordCount: 12,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const resettleChapterState = vi.fn().mockResolvedValue(
      createSettledOutput("repaired draft"),
    );

    const result = await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: createInitialOutput({
        content: "original draft",
        wordCount: 13,
        updatedState: "state: original",
        updatedLedger: "ledger: original",
        updatedHooks: "hooks: original",
      }),
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      resettleChapterState,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledTimes(1);
    expect(reviseChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "original draft",
      1,
      [failingAudit.issues[0]],
      "rework",
      "xuanhuan",
      {
        lengthSpec: LENGTH_SPEC,
        truthContext: {
          candidate: {
            currentState: "state: original",
            ledger: "ledger: original",
            hooks: "hooks: original",
          },
        },
      },
    );
    expect(result.finalContent).toBe("repaired draft");
    expect(result.revised).toBe(true);
    expect(result.auditResult.passed).toBe(true);
    expect(resettleChapterState).toHaveBeenCalledTimes(1);
    expect(resettleChapterState).toHaveBeenCalledWith("repaired draft");
    expect(auditChapter).toHaveBeenNthCalledWith(
      2,
      "/tmp/book",
      "repaired draft",
      1,
      "xuanhuan",
      {
        temperature: 0,
        truthContext: {
          candidate: {
            currentState: "state: repaired draft",
            ledger: "ledger: repaired draft",
            hooks: "hooks: repaired draft",
          },
        },
      },
    );
  });

  it("escalates structural audit failures beyond spot-fix during the inline review cycle", async () => {
    const failingAudit = createAuditResult({
      passed: false,
      issues: [
        {
          severity: "critical",
          category: "大纲偏离检测",
          description: "chapter skipped the planned beat",
          suggestion: "restore the planned beat",
        },
        {
          severity: "critical",
          category: "读者期待管理",
          description: "chapter skipped a promised payoff",
          suggestion: "pay off the promised setup first",
        },
      ],
      summary: "needs structural repair",
    });
    const auditChapter = vi.fn()
      .mockResolvedValueOnce(failingAudit)
      .mockResolvedValueOnce(createAuditResult());
    const reviseChapter = vi.fn().mockResolvedValue({
      revisedContent: "rebuilt draft",
      wordCount: 12,
      fixedIssues: ["fixed"],
      updatedState: "",
      updatedLedger: "",
      updatedHooks: "",
      tokenUsage: ZERO_USAGE,
    });
    const normalizeDraftLengthIfNeeded = vi.fn()
      .mockResolvedValueOnce({
        content: "original draft",
        wordCount: 13,
        applied: false,
        tokenUsage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "rebuilt draft",
        wordCount: 12,
        applied: false,
        tokenUsage: ZERO_USAGE,
      });
    const resettleChapterState = vi.fn().mockResolvedValue(
      createSettledOutput("rebuilt draft"),
    );

    await runChapterReviewCycle({
      book: { genre: "xuanhuan" },
      bookDir: "/tmp/book",
      chapterNumber: 1,
      initialOutput: createInitialOutput({
        content: "original draft",
        wordCount: 13,
        updatedState: "state: original",
        updatedLedger: "ledger: original",
        updatedHooks: "hooks: original",
      }),
      lengthSpec: LENGTH_SPEC,
      reducedControlInput: undefined,
      initialUsage: ZERO_USAGE,
      resettleChapterState,
      createReviser: () => ({ reviseChapter }),
      auditor: { auditChapter },
      normalizeDraftLengthIfNeeded,
      assertChapterContentNotEmpty: () => undefined,
      addUsage: (left, right) => ({
        promptTokens: left.promptTokens + (right?.promptTokens ?? 0),
        completionTokens: left.completionTokens + (right?.completionTokens ?? 0),
        totalTokens: left.totalTokens + (right?.totalTokens ?? 0),
      }),
      restoreLostAuditIssues: (_previous, next) => next,
      analyzeAITells: () => ({ issues: [] as AuditIssue[] }),
      analyzeSensitiveWords: () => ({ found: [] as Array<{ severity: "warn" | "block" }>, issues: [] as AuditIssue[] }),
      logWarn: () => undefined,
      logStage: () => undefined,
    });

    expect(reviseChapter).toHaveBeenCalledWith(
      "/tmp/book",
      "original draft",
      1,
      failingAudit.issues,
      "rewrite",
      "xuanhuan",
      {
        lengthSpec: LENGTH_SPEC,
        truthContext: {
          candidate: {
            currentState: "state: original",
            ledger: "ledger: original",
            hooks: "hooks: original",
          },
        },
      },
    );
  });
});
