import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import { TitleRefinerAgent } from "../agents/title-refiner.js";
import { WriterAgent, type WriteChapterOutput } from "../agents/writer.js";
import { ContinuityAuditor } from "../agents/continuity.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { LengthNormalizerAgent } from "../agents/length-normalizer.js";

async function createRunnerFixture(): Promise<{
  root: string;
  runner: PipelineRunner;
  state: StateManager;
  bookId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inkos-title-test-"));
  const state = new StateManager(root);
  const bookId = "test-book";
  const now = "2026-04-18T00:00:00.000Z";
  const book: BookConfig = {
    id: bookId,
    title: "Test Book",
    platform: "tomato",
    genre: "fantasy-light-novel",
    status: "active",
    targetChapters: 20,
    chapterWordCount: 3000,
    language: "zh",
    createdAt: now,
    updatedAt: now,
  };

  await state.saveBookConfig(bookId, book);
  await mkdir(join(state.bookDir(bookId), "story"), { recursive: true });
  await mkdir(join(state.bookDir(bookId), "chapters"), { recursive: true });

  await Promise.all([
    writeFile(join(state.bookDir(bookId), "story", "book_rules.md"), "---\nversion: \"1.0\"\n---\n\n## 标题规则\n- 标题必须优雅。\n", "utf-8"),
    writeFile(join(state.bookDir(bookId), "story", "current_state.md"), "# 当前状态\n\n| 字段 | 值 |\n| --- | --- |\n| 当前章节 | 0 |\n", "utf-8"),
    writeFile(join(state.bookDir(bookId), "story", "pending_hooks.md"), "# 伏笔池\n", "utf-8"),
  ]);

  const runner = new PipelineRunner({
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.7,
        maxTokens: 4096,
        thinkingBudget: 0,
        maxTokensCap: null,
      },
    } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
    model: "test-model",
    projectRoot: root,
    inputGovernanceMode: "legacy",
  });

  return { root, runner, state, bookId };
}

function createWriterOutput(params: {
  chapterNumber: number;
  title: string;
  content: string;
}): WriteChapterOutput {
  const chapterSummary = `| ${params.chapterNumber} | ${params.title} | 陈渊 | 事件 | 状态 | 伏笔 | 轻快 | 主线 |`;
  return {
    chapterNumber: params.chapterNumber,
    title: params.title,
    content: params.content,
    wordCount: params.content.length,
    preWriteCheck: "| 检查项 | 本章记录 | 备注 |\n| --- | --- | --- |\n| 大纲锚定 | 主线推进 | |",
    postSettlement: "| 结算项 | 本章记录 | 备注 |\n| --- | --- | --- |\n| 伏笔变动 | 无 | |",
    updatedState: "# 当前状态\n\n| 字段 | 值 |\n| --- | --- |\n| 当前章节 | 1 |\n| 当前目标 | 守住主线 |\n",
    updatedLedger: "",
    updatedHooks: "# 伏笔池\n",
    chapterSummary,
    updatedSubplots: "# 支线进度板\n",
    updatedEmotionalArcs: "# 情感弧线\n",
    updatedCharacterMatrix: "# 角色交互矩阵\n",
    postWriteErrors: [],
    postWriteWarnings: [],
  };
}

describe("chapter title refinement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retitleChapters keeps index / manuscript / summaries / snapshots aligned", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    const chaptersDir = join(bookDir, "chapters");
    const snapshotsDir = join(storyDir, "snapshots");

    await Promise.all([
      mkdir(join(storyDir, "state"), { recursive: true }),
      mkdir(join(snapshotsDir, "1", "state"), { recursive: true }),
      mkdir(join(snapshotsDir, "2", "state"), { recursive: true }),
    ]);

    await Promise.all([
      writeFile(join(chaptersDir, "0001_旧门.md"), "# 第1章 旧门\n\n第一章正文。", "utf-8"),
      writeFile(join(chaptersDir, "0002_灰灯.md"), "# 第2章 灰灯\n\n第二章正文。", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 旧门 | 陈渊 | 第一章事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "| 2 | 灰灯 | 陈渊 | 第二章事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(storyDir, "state", "chapter_summaries.json"), JSON.stringify({
        rows: [
          { chapter: 1, title: "旧门", characters: "陈渊", events: "第一章事件", stateChanges: "状态变化", hookActivity: "伏笔", mood: "轻快", chapterType: "主线" },
          { chapter: 2, title: "灰灯", characters: "陈渊", events: "第二章事件", stateChanges: "状态变化", hookActivity: "伏笔", mood: "轻快", chapterType: "主线" },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(snapshotsDir, "1", "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 旧门 | 陈渊 | 第一章事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(snapshotsDir, "1", "state", "chapter_summaries.json"), JSON.stringify({
        rows: [
          { chapter: 1, title: "旧门", characters: "陈渊", events: "第一章事件", stateChanges: "状态变化", hookActivity: "伏笔", mood: "轻快", chapterType: "主线" },
        ],
      }, null, 2), "utf-8"),
      writeFile(join(snapshotsDir, "2", "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 旧门 | 陈渊 | 第一章事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "| 2 | 灰灯 | 陈渊 | 第二章事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(snapshotsDir, "2", "state", "chapter_summaries.json"), JSON.stringify({
        rows: [
          { chapter: 1, title: "旧门", characters: "陈渊", events: "第一章事件", stateChanges: "状态变化", hookActivity: "伏笔", mood: "轻快", chapterType: "主线" },
          { chapter: 2, title: "灰灯", characters: "陈渊", events: "第二章事件", stateChanges: "状态变化", hookActivity: "伏笔", mood: "轻快", chapterType: "主线" },
        ],
      }, null, 2), "utf-8"),
      state.saveChapterIndex(bookId, [
        {
          number: 1,
          title: "旧门",
          status: "approved" as ChapterMeta["status"],
          wordCount: 10,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
          auditIssues: [],
          lengthWarnings: [],
        },
        {
          number: 2,
          title: "灰灯",
          status: "approved" as ChapterMeta["status"],
          wordCount: 10,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
          auditIssues: [],
          lengthWarnings: [],
        },
      ]),
    ]);

    vi.spyOn(TitleRefinerAgent.prototype, "refineChapterTitle")
      .mockResolvedValueOnce({
        title: "女神的召唤与三枚铜币",
        summary: "retitled 1",
      })
      .mockResolvedValueOnce({
        title: "公会图书馆与女神的欠条",
        summary: "retitled 2",
      });

    try {
      const result = await runner.retitleChapters(bookId, { fromChapter: 1, toChapter: 2 });
      const index = await state.loadChapterIndex(bookId);
      const liveSummary = await readFile(join(storyDir, "chapter_summaries.md"), "utf-8");
      const snapshotOne = await readFile(join(snapshotsDir, "1", "chapter_summaries.md"), "utf-8");
      const snapshotTwo = await readFile(join(snapshotsDir, "2", "chapter_summaries.md"), "utf-8");
      const chapterFiles = await readdir(chaptersDir);
      const chapterOneBody = await readFile(join(chaptersDir, "0001_女神的召唤与三枚铜币.md"), "utf-8");

      expect(result.changedCount).toBe(2);
      expect(index.map((chapter) => chapter.title)).toEqual([
        "女神的召唤与三枚铜币",
        "公会图书馆与女神的欠条",
      ]);
      expect(chapterFiles).toContain("0001_女神的召唤与三枚铜币.md");
      expect(chapterFiles).toContain("0002_公会图书馆与女神的欠条.md");
      expect(chapterOneBody).toContain("# 第1章 女神的召唤与三枚铜币");
      expect(liveSummary).toContain("| 1 | 女神的召唤与三枚铜币 |");
      expect(liveSummary).toContain("| 2 | 公会图书馆与女神的欠条 |");
      expect(snapshotOne).toContain("| 1 | 女神的召唤与三枚铜币 |");
      expect(snapshotTwo).toContain("| 1 | 女神的召唤与三枚铜币 |");
      expect(snapshotTwo).toContain("| 2 | 公会图书馆与女神的欠条 |");
      await expect(stat(join(storyDir, "state", "chapter_summaries.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writeNextChapter persists the AI-reviewed title instead of keeping a duplicate shell", async () => {
    const { root, runner, state, bookId } = await createRunnerFixture();
    const bookDir = state.bookDir(bookId);
    const chaptersDir = join(bookDir, "chapters");

    await Promise.all([
      writeFile(join(bookDir, "story", "current_state.md"), "# 当前状态\n\n| 字段 | 值 |\n| --- | --- |\n| 当前章节 | 1 |\n| 当前目标 | 守住主线 |\n", "utf-8"),
      writeFile(join(bookDir, "story", "chapter_summaries.md"), [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | 回声 | 陈渊 | 旧事件 | 状态变化 | 伏笔 | 轻快 | 主线 |",
        "",
      ].join("\n"), "utf-8"),
      writeFile(join(chaptersDir, "0001_回声.md"), "# 第1章 回声\n\n旧章节正文。", "utf-8"),
      state.saveChapterIndex(bookId, [{
        number: 1,
        title: "回声",
        status: "approved" as ChapterMeta["status"],
        wordCount: 6,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
        auditIssues: [],
        lengthWarnings: [],
      }]),
    ]);
    await state.snapshotState(bookId, 1);

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      createWriterOutput({
        chapterNumber: 2,
        title: "回声",
        content: "第二章正文保持主线推进。",
      }),
    );
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "clean",
    });
    vi.spyOn(LengthNormalizerAgent.prototype, "normalizeChapter").mockImplementation(async (input) => ({
      normalizedContent: input.chapterContent,
      finalCount: input.chapterContent.length,
      applied: false,
      mode: "none",
    }));
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      passed: true,
      warnings: [],
    });
    vi.spyOn(TitleRefinerAgent.prototype, "refineChapterTitle").mockResolvedValue({
      title: "塔楼铜铃与守夜人的回声",
      summary: "retitled before persist",
    });

    try {
      const result = await runner.writeNextChapter(bookId);
      const index = await state.loadChapterIndex(bookId);
      const chapterFiles = await readdir(chaptersDir);

      expect(result.title).toBe("塔楼铜铃与守夜人的回声");
      expect(index[1]?.title).toBe("塔楼铜铃与守夜人的回声");
      expect(chapterFiles).toContain("0002_塔楼铜铃与守夜人的回声.md");
      await expect(readFile(join(chaptersDir, "0002_塔楼铜铃与守夜人的回声.md"), "utf-8")).resolves.toContain(
        "# 第2章 塔楼铜铃与守夜人的回声",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
