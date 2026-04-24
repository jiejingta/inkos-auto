import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaseAgent } from "../agents/base.js";

const { chatCompletionMock } = vi.hoisted(() => ({
  chatCompletionMock: vi.fn(),
}));

vi.mock("../llm/provider.js", async () => {
  const actual = await vi.importActual<typeof import("../llm/provider.js")>("../llm/provider.js");
  return {
    ...actual,
    chatCompletion: chatCompletionMock,
  };
});

class TestAgent extends BaseAgent {
  get name(): string {
    return "test-agent";
  }

  async run(): Promise<void> {
    const prompts = await this.applyPromptOverride("test.prompt", {
      system: "system prompt",
      user: "user prompt",
    });
    await this.chat([
      { role: "system", content: prompts.system ?? "" },
      { role: "user", content: prompts.user ?? "" },
    ], {
      temperature: 0.4,
      maxTokens: 128,
    });
  }
}

describe("BaseAgent raw trace logging", () => {
  beforeEach(() => {
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: "raw completion",
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes request and response records to inkos-ai.log", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-base-agent-test-"));
    const agent = new TestAgent({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        baseUrl: "https://example.com/v1",
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          maxTokensCap: null,
          thinkingBudget: 0,
          extra: {},
        },
      },
      model: "test-model",
      projectRoot: root,
      bookId: "book-1",
    });

    try {
      await agent.run();

      const logContent = await readFile(join(root, "inkos-ai.log"), "utf-8");
      const entries = logContent.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        phase: "request",
        promptId: "test.prompt",
        agent: "test-agent",
        bookId: "book-1",
        model: "test-model",
        provider: "openai",
        baseUrl: "https://example.com/v1",
        temperature: 0.4,
        maxTokens: 128,
      });
      expect(entries[0]?.messages).toEqual([
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ]);
      expect(entries[1]).toMatchObject({
        phase: "response",
        promptId: "test.prompt",
        agent: "test-agent",
        content: "raw completion",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
