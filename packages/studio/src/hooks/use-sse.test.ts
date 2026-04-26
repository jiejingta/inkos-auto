import { describe, expect, it } from "vitest";
import { appendSSEMessage, STUDIO_SSE_EVENTS, STUDIO_SSE_MESSAGE_LIMIT } from "./use-sse";

describe("STUDIO_SSE_EVENTS", () => {
  it("covers the server lifecycle events that drive the UI", () => {
    expect(STUDIO_SSE_EVENTS).toEqual(expect.arrayContaining([
      "book:creating",
      "book:created",
      "book:deleted",
      "book:error",
      "write:start",
      "write:complete",
      "write:error",
      "draft:start",
      "draft:complete",
      "draft:error",
      "daemon:started",
      "daemon:stopped",
      "daemon:error",
      "audit:start",
      "audit:complete",
      "audit:error",
      "revise:start",
      "revise:complete",
      "revise:error",
      "rewrite:start",
      "rewrite:complete",
      "rewrite:error",
      "agent:start",
      "agent:complete",
      "agent:error",
      "import:start",
      "import:complete",
      "import:error",
      "fanfic:start",
      "fanfic:complete",
      "fanfic:error",
      "fanfic:refresh:start",
      "fanfic:refresh:complete",
      "fanfic:refresh:error",
      "style:start",
      "style:complete",
      "style:error",
      "radar:start",
      "radar:complete",
      "radar:error",
      "log",
      "llm:progress",
      "ping",
    ]));
  });
});

describe("appendSSEMessage", () => {
  it("keeps the newest 1000 server-sent events", () => {
    const messages = Array.from({ length: STUDIO_SSE_MESSAGE_LIMIT + 1 }, (_, index) => ({
      event: "log",
      data: { message: String(index) },
      timestamp: index,
    })).reduce((items, message) => appendSSEMessage(items, message), [] as ReturnType<typeof appendSSEMessage>);

    expect(messages).toHaveLength(STUDIO_SSE_MESSAGE_LIMIT);
    expect(messages[0]?.timestamp).toBe(1);
    expect(messages.at(-1)?.timestamp).toBe(STUDIO_SSE_MESSAGE_LIMIT);
  });
});
