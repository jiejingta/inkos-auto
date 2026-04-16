import { describe, expect, it } from "vitest";
import { formatDaemonEventMessage } from "./DaemonControl";

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
