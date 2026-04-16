import { describe, expect, it } from "vitest";
import {
  evaluateEditorialAuditGate,
  formatAuditIssue,
  type AuditIssue,
} from "../agents/continuity.js";

function createIssue(overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    severity: "warning",
    category: "Pacing Check",
    description: "scene cadence is a little flat",
    suggestion: "tighten the scene ending",
    ...overrides,
  };
}

describe("evaluateEditorialAuditGate", () => {
  it("rejects any critical issue", () => {
    const decision = evaluateEditorialAuditGate({
      issues: [createIssue({ severity: "critical", category: "Timeline Check" })],
      language: "en",
    });

    expect(decision.passed).toBe(false);
    expect(decision.rejectionReasons).toContain("contains critical issues");
  });

  it("rejects warnings that would pollute long-term story state", () => {
    const decision = evaluateEditorialAuditGate({
      issues: [createIssue({
        category: "Timeline Check",
        description: "the chapter contradicts the established timeline",
      })],
      language: "en",
    });

    expect(decision.passed).toBe(false);
    expect(decision.statePollutingWarnings).toEqual([
      "[warning] Timeline Check: the chapter contradicts the established timeline",
    ]);
  });

  it("rejects three or more ordinary warnings", () => {
    const decision = evaluateEditorialAuditGate({
      issues: [
        createIssue({ category: "Pacing Check" }),
        createIssue({ category: "Style Check", description: "prose is repetitive" }),
        createIssue({ category: "Dialogue Authenticity Check", description: "voices are too similar" }),
      ],
      language: "en",
    });

    expect(decision.passed).toBe(false);
    expect(decision.ordinaryWarningCount).toBe(3);
  });

  it("rejects repeated warning categories across consecutive chapters", () => {
    const repeated = formatAuditIssue(createIssue({
      category: "Pacing Check",
      description: "recent chapters all end on the same beat",
    }));
    const decision = evaluateEditorialAuditGate({
      issues: [createIssue({
        category: "Pacing Check",
        description: "this chapter repeats the same pacing problem",
      })],
      previousChapterAuditIssues: [repeated],
      language: "en",
    });

    expect(decision.passed).toBe(false);
    expect(decision.repeatedWarnings).toEqual([
      "[warning] Pacing Check: this chapter repeats the same pacing problem",
    ]);
  });

  it("approves info-only issues or a single light surface warning", () => {
    expect(evaluateEditorialAuditGate({
      issues: [createIssue({ severity: "info", category: "Style Check" })],
      language: "en",
    }).passed).toBe(true);

    expect(evaluateEditorialAuditGate({
      issues: [createIssue({
        category: "Pacing Check",
        description: "one transition could be sharper",
      })],
      language: "en",
    }).passed).toBe(true);
  });
});
