import type { AuditIssue } from "../agents/continuity.js";
import type { ReviseMode } from "../agents/reviser.js";

const NARRATIVE_STRUCTURE_PATTERNS = [
  "大纲偏离",
  "outline drift",
  "读者期待",
  "reader expectation",
];

const STRUCTURAL_CONTINUITY_PATTERNS = [
  ...NARRATIVE_STRUCTURE_PATTERNS,
  "设定/正史/世界规则漂移",
  "world rule",
  "canon drift",
  "setting drift",
  "时间线矛盾",
  "timeline",
  "战力或资源设定不一致",
  "resource inconsistency",
  "power scaling",
  "角色动机或关系连续性",
  "relationship continuity",
  "character motivation",
];

export interface RevisionModeResolution {
  readonly mode: ReviseMode;
  readonly rationale: string;
  readonly blockingCount: number;
  readonly criticalCount: number;
}

export function resolveRevisionMode(params: {
  readonly issues: ReadonlyArray<Pick<AuditIssue, "severity" | "category">>;
  readonly requestedMode?: ReviseMode;
  readonly consecutiveFailures?: number;
}): RevisionModeResolution {
  const requestedMode = params.requestedMode ?? "spot-fix";
  const blockingIssues = params.issues.filter(
    (issue) => issue.severity === "warning" || issue.severity === "critical",
  );
  const criticalCount = blockingIssues.filter((issue) => issue.severity === "critical").length;
  const consecutiveFailures = params.consecutiveFailures ?? 0;

  if (requestedMode !== "spot-fix") {
    return {
      mode: requestedMode,
      rationale: `requested mode "${requestedMode}" preserved`,
      blockingCount: blockingIssues.length,
      criticalCount,
    };
  }

  if (blockingIssues.length === 0) {
    return {
      mode: "spot-fix",
      rationale: "no blocking issues detected",
      blockingCount: 0,
      criticalCount: 0,
    };
  }

  const normalizedCategories = blockingIssues
    .map((issue) => issue.category.trim().toLowerCase());
  const hasNarrativeStructureIssue = normalizedCategories.some((category) =>
    NARRATIVE_STRUCTURE_PATTERNS.some((pattern) => category.includes(pattern)),
  );
  const hasStructuralContinuityIssue = normalizedCategories.some((category) =>
    STRUCTURAL_CONTINUITY_PATTERNS.some((pattern) => category.includes(pattern)),
  );
  const narrativeCriticalCount = blockingIssues.filter((issue, index) =>
    issue.severity === "critical"
    && NARRATIVE_STRUCTURE_PATTERNS.some((pattern) => normalizedCategories[index]?.includes(pattern) ?? false),
  ).length;
  const structuralCriticalCount = blockingIssues.filter((issue, index) =>
    issue.severity === "critical"
    && STRUCTURAL_CONTINUITY_PATTERNS.some((pattern) => normalizedCategories[index]?.includes(pattern) ?? false),
  ).length;

  if (hasNarrativeStructureIssue) {
    if (narrativeCriticalCount >= 2) {
      return {
        mode: "rewrite",
        rationale: "narrative structure drift exceeded safe local repair scope",
        blockingCount: blockingIssues.length,
        criticalCount,
      };
    }

    if (narrativeCriticalCount === 1) {
      return {
        mode: "rework",
        rationale: "narrative structure drift needs scene-level rework instead of spot-fix",
        blockingCount: blockingIssues.length,
        criticalCount,
      };
    }

    return {
      mode: "spot-fix",
      rationale: "narrative structure warning remains locally repairable",
      blockingCount: blockingIssues.length,
      criticalCount,
    };
  }

  if (hasStructuralContinuityIssue && structuralCriticalCount > 0) {
    if (consecutiveFailures >= 4 && criticalCount >= 2) {
      return {
        mode: "rewrite",
        rationale: "structural continuity criticals persisted across repeated failures",
        blockingCount: blockingIssues.length,
        criticalCount,
      };
    }

    return {
      mode: "rework",
      rationale: "structural continuity critical needs scene-level rework instead of spot-fix",
      blockingCount: blockingIssues.length,
      criticalCount,
    };
  }

  if (hasStructuralContinuityIssue) {
    return {
      mode: "spot-fix",
      rationale: "structural continuity warning remains locally repairable",
      blockingCount: blockingIssues.length,
      criticalCount,
    };
  }

  if (consecutiveFailures >= 4 && (criticalCount > 0 || blockingIssues.length >= 4)) {
    return {
      mode: "rework",
      rationale: "blocking issues persisted across 4+ failures, widening revision scope",
      blockingCount: blockingIssues.length,
      criticalCount,
    };
  }

  return {
    mode: "spot-fix",
    rationale: "blocking issues remain locally repairable",
    blockingCount: blockingIssues.length,
    criticalCount,
  };
}
