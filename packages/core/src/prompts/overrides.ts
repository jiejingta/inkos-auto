import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PromptOverrideMode = "inherit" | "append" | "replace";

export interface PromptOverrideSegment {
  readonly mode: PromptOverrideMode;
  readonly text: string;
}

export interface PromptOverrideEntry {
  readonly system?: PromptOverrideSegment;
  readonly user?: PromptOverrideSegment;
}

export type PromptOverridesMap = Readonly<Record<string, PromptOverrideEntry>>;

function normalizeSegment(input: unknown): PromptOverrideSegment | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as { mode?: unknown; text?: unknown };
  const mode = candidate.mode === "append" || candidate.mode === "replace"
    ? candidate.mode
    : candidate.mode === "inherit"
      ? "inherit"
      : "inherit";
  const text = typeof candidate.text === "string" ? candidate.text : "";

  if (mode === "inherit" && text.trim().length === 0) {
    return undefined;
  }

  return { mode, text };
}

function normalizeEntry(input: unknown): PromptOverrideEntry | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as { system?: unknown; user?: unknown };
  const system = normalizeSegment(candidate.system);
  const user = normalizeSegment(candidate.user);

  if (!system && !user) {
    return undefined;
  }

  return {
    ...(system ? { system } : {}),
    ...(user ? { user } : {}),
  };
}

function applySegment(
  base: string | undefined,
  override: PromptOverrideSegment | undefined,
): string | undefined {
  if (!override || override.mode === "inherit" || override.text.trim().length === 0) {
    return base;
  }

  if (override.mode === "replace") {
    return override.text;
  }

  return base && base.trim().length > 0
    ? `${base}\n\n${override.text}`
    : override.text;
}

export async function loadPromptOverrides(projectRoot: string): Promise<PromptOverridesMap> {
  if (!projectRoot || projectRoot.trim().length === 0) {
    return {};
  }

  try {
    const raw = await readFile(join(projectRoot, "inkos.json"), "utf-8");
    const parsed = JSON.parse(raw) as { promptOverrides?: unknown };
    if (!parsed.promptOverrides || typeof parsed.promptOverrides !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed.promptOverrides as Record<string, unknown>)
        .map(([promptId, entry]) => [promptId, normalizeEntry(entry)])
        .filter((entry): entry is [string, PromptOverrideEntry] => Boolean(entry[1])),
    );
  } catch {
    return {};
  }
}

export async function applyPromptOverridePair(
  projectRoot: string,
  promptId: string,
  prompts: {
    readonly system?: string;
    readonly user?: string;
  },
): Promise<{
  readonly system?: string;
  readonly user?: string;
}> {
  const overrides = await loadPromptOverrides(projectRoot);
  const override = overrides[promptId];

  return {
    system: applySegment(prompts.system, override?.system),
    user: applySegment(prompts.user, override?.user),
  };
}
