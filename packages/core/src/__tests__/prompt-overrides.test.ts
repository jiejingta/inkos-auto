import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPromptOverridePair, loadPromptOverrides } from "../prompts/overrides.js";
import { readPromptCatalogWithSnippets } from "../prompts/catalog.js";

const roots: string[] = [];

async function makeProjectRoot(promptOverrides?: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkos-prompts-"));
  roots.push(root);
  await writeFile(join(root, "inkos.json"), JSON.stringify({
    name: "test-project",
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      temperature: 0.7,
      maxTokens: 1024,
      stream: false,
    },
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * * *",
      },
      maxConcurrentBooks: 1,
      chaptersPerCycle: 1,
      retryDelayMs: 0,
      cooldownAfterChapterMs: 0,
      maxChaptersPerDay: 10,
      qualityGates: {
        maxAuditRetries: 2,
        pauseAfterConsecutiveFailures: 3,
        retryTemperatureStep: 0.1,
      },
    },
    ...(promptOverrides ? { promptOverrides } : {}),
  }, null, 2), "utf-8");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0, roots.length).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prompt overrides", () => {
  it("loads normalized prompt override entries from inkos.json", async () => {
    const root = await makeProjectRoot({
      "writer.creative-draft": {
        system: { mode: "append", text: "extra system rule" },
        user: { mode: "replace", text: "rewritten user prompt" },
      },
    });

    await expect(loadPromptOverrides(root)).resolves.toEqual({
      "writer.creative-draft": {
        system: { mode: "append", text: "extra system rule" },
        user: { mode: "replace", text: "rewritten user prompt" },
      },
    });
  });

  it("applies append and replace modes to resolved prompt text", async () => {
    const root = await makeProjectRoot({
      "writer.creative-draft": {
        system: { mode: "append", text: "Appendix" },
        user: { mode: "replace", text: "Custom user" },
      },
    });

    await expect(applyPromptOverridePair(root, "writer.creative-draft", {
      system: "Base system",
      user: "Base user",
    })).resolves.toEqual({
      system: "Base system\n\nAppendix",
      user: "Custom user",
    });
  });
});

describe("prompt catalog", () => {
  it("reads source snippets for key prompt entries", async () => {
    const prompts = await readPromptCatalogWithSnippets();
    const continuity = prompts.find((entry) => entry.id === "continuity.audit-chapter");
    const agentLoop = prompts.find((entry) => entry.id === "pipeline.agent-loop");
    const styleGuide = prompts.find((entry) => entry.id === "pipeline.style-guide");
    const draftHelper = prompts.find((entry) => entry.id === "interaction.develop-book-draft");

    expect(continuity?.systemSnippets[0]?.content).toContain("const systemPrompt = isEnglish");
    expect(continuity?.userSnippets[0]?.content).toContain("const userPrompt = isEnglish");
    expect(agentLoop?.systemSnippets[0]?.content).toContain("const systemPrompt = `你是 InkOS 小说写作 Agent");
    expect(styleGuide?.systemSnippets[0]?.content).toContain("const styleGuideSystemPrompt = `你是一位文学风格分析专家。");
    expect(styleGuide?.userSnippets[0]?.content).toContain("const styleGuideUserPrompt =");
    expect(draftHelper?.systemSnippets[0]?.content).toContain("const draftSystemPrompt = [");
    expect(draftHelper?.userSnippets[0]?.content).toContain("const draftUserPrompt = JSON.stringify({");
  });
});
