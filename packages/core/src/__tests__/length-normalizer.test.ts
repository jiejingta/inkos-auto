import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../agents/base.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";
import { LengthSpecSchema } from "../models/length-governance.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const AGENT_CONTEXT = {
  client: {
    provider: "openai",
    apiFormat: "chat",
    stream: false,
    defaults: {
      temperature: 0.7,
      maxTokens: 4096,
      thinkingBudget: 0, maxTokensCap: null,
      extra: {},
    },
  } as const,
  model: "test-model",
  projectRoot: "/tmp/inkos-length-normalizer-test",
};

function createAgent(): LengthNormalizerAgent {
  return new LengthNormalizerAgent(AGENT_CONTEXT as never);
}

describe("LengthNormalizerAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compresses a long draft while preserving required markers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "压缩后的正文。".repeat(30) + "[[KEEP_ME]]",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "多余句子。".repeat(80) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] and remove redundancy.",
      reducedControlBlock: "Avoid [[FORBIDDEN]] and keep the scene on target.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("compress");
    expect(result.normalizedContent).toContain("[[KEEP_ME]]");
    expect(result.normalizedContent).not.toContain("[[FORBIDDEN]]");
    expect(result.finalCount).toBe(countChapterLength(result.normalizedContent, "zh_chars"));
    expect(result.finalCount).toBeLessThan(countChapterLength(draft, "zh_chars"));
  });

  it("expands a short draft without inserting forbidden markers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "扩写后的正文，补足细节和过渡，但不引入禁词。".repeat(8),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "expand",
    });
    const draft = "开头太短。";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Keep the chapter focused on the mentor conflict.",
      reducedControlBlock: "Forbidden marker: [[FORBIDDEN]].",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.mode).toBe("expand");
    expect(result.normalizedContent).not.toContain("[[FORBIDDEN]]");
    expect(result.finalCount).toBe(countChapterLength(result.normalizedContent, "zh_chars"));
    expect(result.finalCount).toBeGreaterThan(countChapterLength(draft, "zh_chars"));
  });

  it("never retries normalization in the same pass", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "仍然过长的正文。".repeat(60),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(100);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve the scene marker [[KEEP_ME]].",
      reducedControlBlock: "Do not invent new subplots.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(false);
    expect(result.mode).toBe("compress");
    expect(result.normalizedContent).toBe(draft);
    expect(result.warning).toContain("rejected");
  });

  it("rejects one-pass output that exits the hard range or moves farther from target", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat")
      .mockResolvedValueOnce({
        content: "乙".repeat(2617),
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "丙".repeat(5501),
        usage: ZERO_USAGE,
      });
    const lengthSpec = LengthSpecSchema.parse({
      target: 3600,
      softMin: 3240,
      softMax: 3960,
      hardMin: 2746,
      hardMax: 4454,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const slightlyLongDraft = "甲".repeat(3990);
    const shortDraft = "丁".repeat(2617);

    const compressedTooFar = await agent.normalizeChapter({
      chapterContent: slightlyLongDraft,
      lengthSpec,
    });
    const expandedTooFar = await agent.normalizeChapter({
      chapterContent: shortDraft,
      lengthSpec: {
        ...lengthSpec,
        normalizeMode: "expand",
      },
    });

    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(compressedTooFar.applied).toBe(false);
    expect(compressedTooFar.normalizedContent).toBe(slightlyLongDraft);
    expect(compressedTooFar.finalCount).toBe(3990);
    expect(compressedTooFar.warning).toContain("rejected");
    expect(expandedTooFar.applied).toBe(false);
    expect(expandedTooFar.normalizedContent).toBe(shortDraft);
    expect(expandedTooFar.finalCount).toBe(2617);
    expect(expandedTooFar.warning).toContain("rejected");
  });

  it("rejects hard-range misses even when they move closer to target", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "乙".repeat(2461),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 3500,
      softMin: 3023,
      softMax: 3977,
      hardMin: 2546,
      hardMax: 4454,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const overlongDraft = "甲".repeat(5208);

    const result = await agent.normalizeChapter({
      chapterContent: overlongDraft,
      lengthSpec,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(false);
    expect(result.normalizedContent).toBe(overlongDraft);
    expect(result.finalCount).toBe(5208);
    expect(result.warning).toContain("outside the hard range");
  });

  it("strips explanatory wrappers from malformed normalizer output", async () => {
    const agent = createAgent();
    const normalizedProse = "压缩后的正文。".repeat(25) + "[[KEEP_ME]]";
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: [
        "我先压缩一下正文。",
        "",
        "```markdown",
        normalizedProse,
        "```",
      ].join("\n"),
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(50) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] only.",
      reducedControlBlock: "No extra commentary.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(normalizedProse);
    expect(result.normalizedContent).not.toContain("我先压缩一下正文");
    expect(result.normalizedContent).not.toContain("```");
  });

  it("falls back to the original chapter when the response contains only wrappers", async () => {
    const agent = createAgent();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "我先压缩一下正文。",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "开头。" + "冗余句子。".repeat(40) + "[[KEEP_ME]]";

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
      chapterIntent: "Preserve [[KEEP_ME]] only.",
      reducedControlBlock: "No extra commentary.",
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(draft);
    expect(result.finalCount).toBe(countChapterLength(draft, "zh_chars"));
  });

  it("preserves legitimate Chinese prose that starts with '我先'", async () => {
    const agent = createAgent();
    const prose = `我先回去了，明天再说。\n${"风从窗缝里灌进来。".repeat(28)}`;
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: prose,
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });
    const draft = "原文。".repeat(80);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(prose);
  });

  it("preserves legitimate English prose that starts with 'I will'", async () => {
    const agent = createAgent();
    const prose = "I will wait here until dawn. The shutters rattled in the wind. ".repeat(20).trim();
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: prose,
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "en_words",
      normalizeMode: "compress",
    });
    const draft = "Original text. ".repeat(80);

    const result = await agent.normalizeChapter({
      chapterContent: draft,
      lengthSpec,
    });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(result.normalizedContent).toBe(prose);
  });

  it("loads writer global rules when book context is available", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-length-normalizer-rules-"));
    const bookDir = join(root, "book");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await Promise.all([
      writeFile(
        join(bookDir, "book.json"),
        JSON.stringify({
          id: "book",
          title: "Book",
          genre: "other",
          platform: "tomato",
          chapterWordCount: 220,
          targetChapters: 20,
          status: "active",
          language: "zh",
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        }, null, 2),
        "utf-8",
      ),
      writeFile(join(bookDir, "story", "style_guide.md"), "# 文风指南\n\n- 保持克制。", "utf-8"),
    ]);

    const agent = new LengthNormalizerAgent({
      ...AGENT_CONTEXT,
      projectRoot: root,
    } as never);
    const chatSpy = vi.spyOn(BaseAgent.prototype as never, "chat").mockResolvedValue({
      content: "压缩后的正文。",
      usage: ZERO_USAGE,
    });
    const lengthSpec = LengthSpecSchema.parse({
      target: 220,
      softMin: 190,
      softMax: 250,
      hardMin: 160,
      hardMax: 280,
      countingMode: "zh_chars",
      normalizeMode: "compress",
    });

    try {
      await agent.normalizeChapter({
        chapterContent: "原文。".repeat(80),
        lengthSpec,
        bookDir,
        genre: "other",
        chapterNumber: 3,
      });

      const messages = chatSpy.mock.calls[0]?.[0] as
        | ReadonlyArray<{ content: string }>
        | undefined;
      const systemPrompt = messages?.[0]?.content ?? "";
      expect(systemPrompt).toContain("## 核心规则");
      expect(systemPrompt).toContain("## 硬性禁令");
      expect(systemPrompt).toContain("## 文风指南");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
