import { beforeEach, describe, expect, it, vi } from "vitest";

const approveChapterMock = vi.fn();
const approveAllPendingChaptersMock = vi.fn();
const loadChapterIndexMock = vi.fn();
const saveChapterIndexMock = vi.fn();
const discardReviewStageMock = vi.fn();
const logMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@actalk/inkos-core", () => ({
  PipelineRunner: class {
    approveChapter = approveChapterMock;
    approveAllPendingChapters = approveAllPendingChaptersMock;
  },
  StateManager: class {
    async loadChapterIndex() {
      return loadChapterIndexMock();
    }

    async saveChapterIndex(...args: unknown[]) {
      return saveChapterIndexMock(...args);
    }

    async discardReviewStage(...args: unknown[]) {
      return discardReviewStageMock(...args);
    }

    async listBooks() {
      return [];
    }

    async loadBookConfig() {
      return {
        title: "Demo Book",
        genre: "xuanhuan",
        language: "zh",
      };
    }
  },
  formatLengthCount: vi.fn(() => "1234字"),
  readGenreProfile: vi.fn(async () => ({ profile: { language: "zh" } })),
  resolveLengthCountingMode: vi.fn(() => "zh_chars"),
}));

vi.mock("../utils.js", () => ({
  findProjectRoot: vi.fn(() => "/project"),
  resolveBookId: vi.fn(async (bookId?: string) => bookId ?? "auto-book"),
  log: logMock,
  logError: logErrorMock,
}));

describe("review command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approveChapterMock.mockResolvedValue({
      chapterNumber: 3,
      promotedReviewStage: true,
    });
    approveAllPendingChaptersMock.mockResolvedValue({
      approvedCount: 2,
      promotedReviewStages: 1,
    });
    loadChapterIndexMock.mockResolvedValue([{
      number: 3,
      title: "Pending",
      status: "audit-failed",
      wordCount: 1200,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      auditIssues: [],
      lengthWarnings: [],
    }]);
    saveChapterIndexMock.mockResolvedValue(undefined);
    discardReviewStageMock.mockResolvedValue(undefined);
  });

  it("routes review approve through pipeline promotion logic", async () => {
    const { reviewCommand } = await import("../commands/review.js");

    await reviewCommand.parseAsync(["node", "review", "approve", "demo-book", "3", "--json"], { from: "node" });

    expect(approveChapterMock).toHaveBeenCalledWith("demo-book", 3);
    expect(JSON.parse(logMock.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      bookId: "demo-book",
      chapter: 3,
      status: "approved",
      promotedReviewStage: true,
    });
  });

  it("routes review approve-all through pipeline promotion logic", async () => {
    const { reviewCommand } = await import("../commands/review.js");

    await reviewCommand.parseAsync(["node", "review", "approve-all", "demo-book", "--json"], { from: "node" });

    expect(approveAllPendingChaptersMock).toHaveBeenCalledWith("demo-book");
    expect(JSON.parse(logMock.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      bookId: "demo-book",
      approvedCount: 2,
      promotedReviewStages: 1,
    });
  });

  it("drops staged review truth when rejecting a chapter but keeping subsequent chapters", async () => {
    const { reviewCommand } = await import("../commands/review.js");

    await reviewCommand.parseAsync(["node", "review", "reject", "demo-book", "3", "--keep-subsequent", "--json"], { from: "node" });

    expect(saveChapterIndexMock).toHaveBeenCalledTimes(1);
    expect(discardReviewStageMock).toHaveBeenCalledWith("demo-book", 3);
  });
});
