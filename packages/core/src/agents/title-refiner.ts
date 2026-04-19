import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import { readBookLanguage, readBookRules, readGenreProfile } from "./rules-reader.js";

export interface RefineChapterTitleOutput {
  readonly title: string;
  readonly summary: string;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export class TitleRefinerAgent extends BaseAgent {
  get name(): string {
    return "title-refiner";
  }

  async refineChapterTitle(params: {
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly currentTitle: string;
    readonly chapterContent: string;
    readonly existingTitles: ReadonlyArray<string>;
    readonly genre?: string;
    readonly mode?: "pipeline" | "retitle";
    readonly retryFeedback?: string;
  }): Promise<RefineChapterTitleOutput> {
    const [styleGuideRaw, parsedRules, bookLanguage, genreProfileResult] = await Promise.all([
      this.readFileSafe(join(params.bookDir, "story/style_guide.md")),
      readBookRules(params.bookDir),
      readBookLanguage(params.bookDir),
      readGenreProfile(this.ctx.projectRoot, params.genre ?? "other"),
    ]);

    const resolvedLanguage = bookLanguage ?? genreProfileResult.profile.language;
    const isEnglish = resolvedLanguage === "en";
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (parsedRules?.body ?? (isEnglish ? "(no style guide)" : "(无文风指南)"));
    const historyBlock = params.existingTitles.length > 0
      ? params.existingTitles
        .map((title, index) => `${index + 1}. ${title}`)
        .join("\n")
      : (isEnglish ? "(no previous titles)" : "(暂无历史标题)");
    const modeInstruction = params.mode === "retitle"
      ? (isEnglish
        ? "This is a batch retitling pass over an existing serial. If the current title is weak, repetitive, placeholder-like, or off-style, replace it decisively."
        : "这是对现有连载的批量重命名。如果当前标题偏弱、重复、像占位符，或明显偏离本书风格，请果断整体换名。")
      : (isEnglish
        ? "This is the final title review before persistence. You may keep the title only if it is already strong, on-style, and clearly distinct from history."
        : "这是章节落盘前的最终标题复审。只有当当前标题已经足够有力、符合本书风格、且与历史标题明显区分时，才允许保留。");
    const retryFeedbackBlock = params.retryFeedback?.trim()
      ? (isEnglish
        ? `\n## Retry Feedback\n${params.retryFeedback.trim()}\n`
        : `\n## 返工反馈\n${params.retryFeedback.trim()}\n`)
      : "";
    const systemPrompt = isEnglish
      ? `You are a chapter title editor for serialized web fiction.

Your job is to review and finalize ONE chapter title.

Rules:
1. Book rules are authoritative. If book rules define a title shell or mandatory marker, obey them.
2. Do not mechanically patch the current title by appending a colon suffix, bracket suffix, serial number, or filler phrase just to dodge duplication.
3. If the current title is weak, repetitive, too vague, placeholder-like, or off-style, replace the whole title.
4. Prefer titles that reflect the chapter's real conflict, event, consequence, or image.
5. Avoid exact duplicates, near-duplicates, and recycled title shells from title history.
6. Output only the final title, not the chapter number.

Return exactly:
=== FINAL_TITLE ===
(title only)

=== REVIEW_SUMMARY ===
(one short paragraph in English explaining keep/replace and the main reason)`
      : `你是连载网文的章节标题编辑。

你的任务是只审查并定稿 ONE 个章节标题。

规则：
1. 书籍规则是最高优先级。若 book rules 明确规定标题结构、词法或必带标记，必须服从。
2. 禁止为了规避重复，在原标题后机械追加冒号后缀、括号后缀、序号或凑数词。
3. 如果当前标题偏弱、重复、过虚、像占位符，或明显偏离本书风格，必须整体重起。
4. 标题优先体现本章真实的冲突、事件、后果或意象。
5. 避免与历史标题 exact duplicate、near duplicate，或继续复用同一命名壳。
6. 输出只写最终标题，不要带“第X章”。

严格按下面格式输出：
=== FINAL_TITLE ===
（只写标题）

=== REVIEW_SUMMARY ===
（用一小段中文说明保留/替换及其主要原因）`;

    const userPrompt = isEnglish
      ? `Finalize the title for chapter ${params.chapterNumber}.

## Current Title
${params.currentTitle}

## Historical Title List
${historyBlock}

## Book Rules / Style Guide
${styleGuide}

## Chapter Content
${params.chapterContent}

## Working Mode
${modeInstruction}${retryFeedbackBlock}`
      : `请为第${params.chapterNumber}章定稿标题。

## 当前标题
${params.currentTitle}

## 历史标题列表
${historyBlock}

## Book Rules / 文风规则
${styleGuide}

## 章节正文
${params.chapterContent}

## 当前任务模式
${modeInstruction}${retryFeedbackBlock}`;

    const prompts = await this.applyPromptOverride("title.refine-chapter", {
      system: systemPrompt,
      user: userPrompt,
    });
    const response = await this.chat([
      { role: "system", content: prompts.system ?? systemPrompt },
      { role: "user", content: prompts.user ?? userPrompt },
    ], {
      temperature: 0.2,
      maxTokens: 2048,
    });

    return {
      ...this.parseOutput(response.content, isEnglish ? "en" : "zh", params.currentTitle),
      tokenUsage: response.usage,
    };
  }

  private parseOutput(
    content: string,
    language: "zh" | "en",
    fallbackTitle: string,
  ): Pick<RefineChapterTitleOutput, "title" | "summary"> {
    const title = this.extractSection(content, "FINAL_TITLE")
      ?? this.extractFallbackTitle(content)
      ?? fallbackTitle;
    const summary = this.extractSection(content, "REVIEW_SUMMARY")
      ?? (language === "en" ? "Title review completed." : "标题审查已完成。");

    return {
      title: this.sanitizeTitle(title, fallbackTitle),
      summary: summary.trim(),
    };
  }

  private extractSection(content: string, tag: string): string | undefined {
    const pattern = new RegExp(`===\\s*${tag}\\s*===\\s*([\\s\\S]*?)(?=\\n===\\s*[A-Z_]+\\s*===|$)`, "u");
    const match = content.match(pattern);
    const value = match?.[1]?.trim();
    return value && value.length > 0 ? value : undefined;
  }

  private extractFallbackTitle(content: string): string | undefined {
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-#*\d.：:)\s]+/u, "").trim())
      .find((line) => line.length > 0);
  }

  private sanitizeTitle(title: string, fallbackTitle: string): string {
    const normalized = title
      .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
      .replace(/^第\s*\d+\s*章[:：\s-]*/u, "")
      .replace(/^chapter\s+\d+\s*[:：-]*/iu, "")
      .replace(/\r?\n/g, " ")
      .trim();
    return normalized.length > 0 ? normalized : fallbackTitle.trim();
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }
}
