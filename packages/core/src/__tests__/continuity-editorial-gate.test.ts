import { describe, expect, it } from "vitest";
import {
  evaluateEditorialAuditGate,
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

  it("allows fewer than six ordinary warnings", () => {
    const decision = evaluateEditorialAuditGate({
      issues: [
        createIssue({ category: "Pacing Check" }),
        createIssue({ category: "Style Check", description: "prose is repetitive" }),
        createIssue({ category: "Dialogue Authenticity Check", description: "voices are too similar" }),
        createIssue({ category: "Reader Expectation Check", description: "payoff lands a beat late" }),
        createIssue({ category: "Arc Flatline Check", description: "arc movement is light" }),
      ],
      language: "en",
    });

    expect(decision.passed).toBe(true);
    expect(decision.ordinaryWarningCount).toBe(5);
  });

  it("rejects six or more ordinary warnings", () => {
    const decision = evaluateEditorialAuditGate({
      issues: [
        createIssue({ category: "Pacing Check" }),
        createIssue({ category: "Style Check", description: "prose is repetitive" }),
        createIssue({ category: "Dialogue Authenticity Check", description: "voices are too similar" }),
        createIssue({ category: "Reader Expectation Check", description: "payoff lands a beat late" }),
        createIssue({ category: "Arc Flatline Check", description: "arc movement is light" }),
        createIssue({ category: "Pacing Monotony Check", description: "the pressure shape repeats" }),
      ],
      language: "en",
    });

    expect(decision.passed).toBe(false);
    expect(decision.ordinaryWarningCount).toBe(6);
    expect(decision.rejectionReasons).toContain("contains 6 or more ordinary warnings");
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
