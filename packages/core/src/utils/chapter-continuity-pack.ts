import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface RevisionContinuityPack {
  readonly previousChapterFullText?: string;
  readonly nextChapterOpening?: string;
  readonly chapterTrail?: string;
}

export async function loadRevisionContinuityPack(
  bookDir: string,
  chapterNumber: number,
  chapterSummaries: string,
  options?: {
    readonly summaryWindowBefore?: number;
    readonly summaryWindowAfter?: number;
    readonly nextOpeningChars?: number;
  },
): Promise<RevisionContinuityPack> {
  const [previousChapterFullText, nextChapterFullText] = await Promise.all([
    loadChapterByNumber(bookDir, chapterNumber - 1),
    loadChapterByNumber(bookDir, chapterNumber + 1),
  ]);

  return {
    previousChapterFullText: previousChapterFullText || undefined,
    nextChapterOpening: nextChapterFullText
      ? extractChapterOpening(nextChapterFullText, options?.nextOpeningChars ?? 1200)
      : undefined,
    chapterTrail: selectChapterSummaryWindow(
      chapterSummaries,
      chapterNumber,
      options?.summaryWindowBefore ?? 3,
      options?.summaryWindowAfter ?? 1,
    ) || undefined,
  };
}

async function loadChapterByNumber(bookDir: string, chapterNumber: number): Promise<string> {
  if (chapterNumber <= 0) return "";
  const chaptersDir = join(bookDir, "chapters");
  try {
    const paddedChapter = String(chapterNumber).padStart(4, "0");
    const files = await readdir(chaptersDir);
    const chapterFile = files.find((file) => file.startsWith(paddedChapter) && file.endsWith(".md"));
    if (!chapterFile) return "";
    return await readFile(join(chaptersDir, chapterFile), "utf-8");
  } catch {
    return "";
  }
}

function extractChapterOpening(content: string, maxChars: number): string {
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  let index = 0;

  while (index < lines.length && lines[index]!.trim().length === 0) {
    index += 1;
  }

  if (index < lines.length && /^#\s+/u.test(lines[index]!.trim())) {
    index += 1;
  }

  while (index < lines.length && lines[index]!.trim().length === 0) {
    index += 1;
  }

  const body = lines.slice(index).join("\n").trim();
  if (body.length <= maxChars) {
    return body;
  }
  return `${body.slice(0, maxChars).trimEnd()}\n[...]`;
}

function selectChapterSummaryWindow(
  summaries: string,
  chapterNumber: number,
  summaryWindowBefore: number,
  summaryWindowAfter: number,
): string {
  if (
    !summaries
    || summaries === "(文件不存在)"
    || summaries === "(文件尚未创建)"
  ) {
    return "";
  }

  const minChapter = Math.max(1, chapterNumber - summaryWindowBefore);
  const maxChapter = chapterNumber + summaryWindowAfter;
  const lines = summaries.split("\n");
  const keptLines: string[] = [];
  let hasMatchingRow = false;

  for (const line of lines) {
    if (!line.trim().startsWith("|")) {
      keptLines.push(line);
      continue;
    }

    if (
      line.includes("---")
      || /^\|\s*(章节|Chapter)\b/iu.test(line)
    ) {
      keptLines.push(line);
      continue;
    }

    const match = line.match(/\|\s*(\d+)\s*\|/u);
    if (!match) {
      keptLines.push(line);
      continue;
    }

    const parsedChapter = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(parsedChapter)) {
      continue;
    }

    if (parsedChapter >= minChapter && parsedChapter <= maxChapter) {
      keptLines.push(line);
      hasMatchingRow = true;
    }
  }

  return hasMatchingRow ? keptLines.join("\n") : "";
}
