import { describe, expect, it } from "vitest";
import { DAEMON_EVENT_LOG_LIMIT, formatDaemonEventMessage, selectDaemonEvents } from "./DaemonControl";

describe("formatDaemonEventMessage", () => {
  it("shows the concrete daemon error instead of only the book id", () => {
    expect(formatDaemonEventMessage({
      event: "daemon:error",
      data: {
        bookId: "book-1",
        error: "429 Too Many Requests",
      },
    })).toBe("book-1: 429 Too Many Requests");
  });

  it("falls back to log message for regular log events", () => {
    expect(formatDaemonEventMessage({
      event: "log",
      data: {
        message: "阶段：撰写章节草稿",
      },
    })).toBe("阶段：撰写章节草稿");
  });

  it("falls back to the book id when no error message is present", () => {
    expect(formatDaemonEventMessage({
      event: "daemon:chapter",
      data: {
        bookId: "book-9",
      },
    })).toBe("book-9");
  });
});

describe("selectDaemonEvents", () => {
  it("keeps the newest 500 daemon log rows", () => {
    const messages = Array.from({ length: DAEMON_EVENT_LOG_LIMIT + 1 }, (_, index) => ({
      event: index % 2 === 0 ? "log" : "daemon:chapter",
      data: { message: String(index) },
      timestamp: index,
    }));

    const selected = selectDaemonEvents([
      { event: "write:start", data: {}, timestamp: -1 },
      ...messages,
    ]);

    expect(selected).toHaveLength(DAEMON_EVENT_LOG_LIMIT);
    expect(selected[0]?.timestamp).toBe(1);
    expect(selected.at(-1)?.timestamp).toBe(DAEMON_EVENT_LOG_LIMIT);
  });
});
