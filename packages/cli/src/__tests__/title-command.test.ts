import { beforeEach, describe, expect, it, vi } from "vitest";

const retitleChaptersMock = vi.fn();
const buildPipelineConfigMock = vi.fn();
const loadBookConfigMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@jiejingtazhu/inkos-core", () => ({
  PipelineRunner: class {
    retitleChapters = retitleChaptersMock;
  },
  StateManager: class {
    async loadBookConfig() {
      return loadBookConfigMock();
    }
  },
}));

vi.mock("../utils.js", () => ({
  loadConfig: vi.fn(async () => ({ llm: {} })),
  buildPipelineConfig: buildPipelineConfigMock,
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  getLegacyMigrationHint: vi.fn(async () => undefined),
  resolveContext: vi.fn(),
  log: logMock,
  logError: logErrorMock,
}));

vi.mock("../localization.js", () => ({
  formatWriteNextComplete: vi.fn(),
  formatWriteNextProgress: vi.fn(),
  formatWriteNextResultLines: vi.fn(),
  resolveCliLanguage: vi.fn(() => "zh"),
}));

describe("write retitle command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadBookConfigMock.mockResolvedValue({ language: "zh" });
    buildPipelineConfigMock.mockReturnValue({});
    retitleChaptersMock.mockResolvedValue({
      bookId: "demo-book",
      changedCount: 1,
      chapters: [
        {
          chapterNumber: 3,
          previousTitle: "旧标题",
          title: "新标题",
          changed: true,
        },
      ],
    });
  });

  it("routes batch retitle to pipeline runner", async () => {
    const { writeCommand } = await import("../commands/write.js");

    await writeCommand.parseAsync(["node", "write", "retitle", "demo-book", "--all", "--from", "3", "--to", "5"], { from: "node" });

    expect(retitleChaptersMock).toHaveBeenCalledWith("demo-book", {
      chapterNumber: undefined,
      fromChapter: 3,
      toChapter: 5,
    });
    expect(logMock).toHaveBeenCalledWith("第3章：\"旧标题\" -> \"新标题\"");
  });
});
