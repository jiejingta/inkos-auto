import { describe, expect, it } from "vitest";
import { resolveRevisionMode } from "../pipeline/revision-strategy.js";

describe("resolveRevisionMode", () => {
  it("keeps spot-fix for locally repairable blocking issues", () => {
    const result = resolveRevisionMode({
      issues: [{
        severity: "warning",
        category: "paragraph-shape",
      }],
    });

    expect(result.mode).toBe("spot-fix");
  });

  it("escalates narrative structure drift to rewrite immediately when multiple criticals exist", () => {
    const result = resolveRevisionMode({
      issues: [
        {
          severity: "critical",
          category: "大纲偏离检测",
        },
        {
          severity: "critical",
          category: "读者期待管理",
        },
      ],
    });

    expect(result.mode).toBe("rewrite");
  });

  it("keeps warning-level world-rule drift in spot-fix scope", () => {
    const result = resolveRevisionMode({
      issues: [{
        severity: "warning",
        category: "设定/正史/世界规则漂移",
      }],
    });

    expect(result.mode).toBe("spot-fix");
  });

  it("promotes repeated structural criticals to rewrite after four consecutive failures", () => {
    const result = resolveRevisionMode({
      consecutiveFailures: 4,
      issues: [
        {
          severity: "critical",
          category: "角色动机或关系连续性断裂",
        },
        {
          severity: "critical",
          category: "时间线矛盾",
        },
      ],
    });

    expect(result.mode).toBe("rewrite");
  });

  it("keeps repeated local warning cleanup in spot-fix scope", () => {
    const result = resolveRevisionMode({
      consecutiveFailures: 6,
      issues: [
        {
          severity: "warning",
          category: "连续性检查",
        },
        {
          severity: "warning",
          category: "设定冲突",
        },
        {
          severity: "warning",
          category: "数据不一致",
        },
      ],
    });

    expect(result.mode).toBe("spot-fix");
  });

  it("preserves explicitly requested non-spot-fix modes", () => {
    const result = resolveRevisionMode({
      requestedMode: "polish",
      issues: [{
        severity: "warning",
        category: "大纲偏离检测",
      }],
    });

    expect(result.mode).toBe("polish");
  });
});
