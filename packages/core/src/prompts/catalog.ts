import { access, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptCatalogSource {
  readonly label: string;
  readonly relativePath: string;
  readonly startMarker: string;
  readonly endMarker?: string;
  readonly maxLines?: number;
}

export interface PromptCatalogEntry {
  readonly id: string;
  readonly group: "agents" | "interaction" | "pipeline";
  readonly agent: string;
  readonly title: string;
  readonly description: string;
  readonly systemSources?: ReadonlyArray<PromptCatalogSource>;
  readonly userSources?: ReadonlyArray<PromptCatalogSource>;
}

export interface PromptCatalogSnippet extends PromptCatalogSource {
  readonly file: string;
  readonly content: string;
}

export interface PromptCatalogEntryWithSnippets extends PromptCatalogEntry {
  readonly systemSnippets: ReadonlyArray<PromptCatalogSnippet>;
  readonly userSnippets: ReadonlyArray<PromptCatalogSnippet>;
}

const PACKAGE_ROOT = join(fileURLToPath(new URL("../../", import.meta.url)));

const PROMPT_CATALOG: ReadonlyArray<PromptCatalogEntry> = [
  {
    id: "architect.init-book",
    group: "agents",
    agent: "architect",
    title: "新书基础设定生成",
    description: "创建新书时，为 story bible、卷纲、book rules、current state、hooks 生成初版基础设定。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/architect.ts",
      startMarker: "const systemPrompt = `你是一个专业的网络小说架构师。",
      endMarker: "const langPrefix =",
      maxLines: 80,
    }],
  },
  {
    id: "architect.import-foundation",
    group: "agents",
    agent: "architect",
    title: "已有码字反推基础设定",
    description: "从已有章节反推 story bible、卷纲和基础控制面，用于导入/接手项目。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/architect.ts",
      startMarker: "const systemPrompt = resolvedLanguage === \"en\"",
      endMarker: "const response = await this.chat([",
      maxLines: 110,
    }],
  },
  {
    id: "architect.init-fanfic",
    group: "agents",
    agent: "architect",
    title: "同人基础设定生成",
    description: "基于原作正典初始化 fanfic 书的基础文档。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/architect.ts",
      startMarker: "const systemPrompt = `你是一个专业的同人小说架构师。",
      endMarker: "const response = await this.chat([",
      maxLines: 90,
    }],
  },
  {
    id: "chapter-analyzer.extract-state",
    group: "agents",
    agent: "chapter-analyzer",
    title: "章节状态提取",
    description: "读取已完成章节，从正文里提取状态变化并更新 tracking files。",
    systemSources: [{
      label: "System Prompt Builder",
      relativePath: "agents/chapter-analyzer.ts",
      startMarker: "private buildSystemPrompt(",
      endMarker: "private buildUserPrompt(",
      maxLines: 220,
    }],
    userSources: [{
      label: "User Prompt Builder",
      relativePath: "agents/chapter-analyzer.ts",
      startMarker: "private buildUserPrompt(params:",
      endMarker: "private extractJsonObject(",
      maxLines: 180,
    }],
  },
  {
    id: "consolidator.volume-summary",
    group: "agents",
    agent: "consolidator",
    title: "卷级摘要压缩",
    description: "把逐章摘要压缩成一段卷级概览。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/consolidator.ts",
      startMarker: "content: `You are a narrative summarizer.",
      endMarker: "{ role: \"user\", content: summary },",
      maxLines: 16,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "agents/consolidator.ts",
      startMarker: "{ role: \"user\", content: summary },",
      endMarker: "]);",
      maxLines: 6,
    }],
  },
  {
    id: "continuity.audit-chapter",
    group: "agents",
    agent: "auditor",
    title: "章节审计",
    description: "核心 continuity / quality 审计入口，按题材和真相文件做多维校验。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/continuity.ts",
      startMarker: "const systemPrompt = isEnglish",
      endMarker: "const ledgerBlock =",
      maxLines: 90,
    }],
    userSources: [{
      label: "User Prompt",
      relativePath: "agents/continuity.ts",
      startMarker: "const userPrompt = isEnglish",
      endMarker: "const chatMessages = [",
      maxLines: 90,
    }],
  },
  {
    id: "fanfic-canon-importer.import-canon",
    group: "agents",
    agent: "fanfic-canon-importer",
    title: "同人原作正典提取",
    description: "从用户提供的原作素材中提取 fanfic canon。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/fanfic-canon-importer.ts",
      startMarker: "const systemPrompt = `你是一个专业的同人创作素材分析师。",
      endMarker: "const response = await this.chat(",
      maxLines: 80,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "agents/fanfic-canon-importer.ts",
      startMarker: "{ role: \"user\", content: sourceText }",
      endMarker: ");",
      maxLines: 6,
    }],
  },
  {
    id: "foundation-reviewer.review-foundation",
    group: "agents",
    agent: "foundation-reviewer",
    title: "基础设定审核",
    description: "初始化书籍后，对 foundation 文档做结构与质量审核。",
    systemSources: [
      {
        label: "中文 System Prompt Builder",
        relativePath: "agents/foundation-reviewer.ts",
        startMarker: "private buildChineseReviewPrompt(",
        endMarker: "private buildEnglishReviewPrompt(",
        maxLines: 60,
      },
      {
        label: "英文 System Prompt Builder",
        relativePath: "agents/foundation-reviewer.ts",
        startMarker: "private buildEnglishReviewPrompt(",
        endMarker: "private buildFoundationExcerpt(",
        maxLines: 60,
      },
    ],
    userSources: [{
      label: "User Prompt Builder",
      relativePath: "agents/foundation-reviewer.ts",
      startMarker: "private buildFoundationExcerpt(",
      endMarker: "private parseReviewResult(",
      maxLines: 70,
    }],
  },
  {
    id: "length-normalizer.normalize-length",
    group: "agents",
    agent: "length-normalizer",
    title: "字数归一化",
    description: "在审计前后对章节做一次压缩/扩展，让章节回到字数区间。",
    systemSources: [{
      label: "System Prompt Builder",
      relativePath: "agents/length-normalizer.ts",
      startMarker: "private buildSystemPrompt(mode:",
      endMarker: "private buildUserPrompt(",
      maxLines: 40,
    }],
    userSources: [{
      label: "User Prompt Builder",
      relativePath: "agents/length-normalizer.ts",
      startMarker: "private buildUserPrompt(",
      endMarker: "private parseResponse(",
      maxLines: 80,
    }],
  },
  {
    id: "radar.market-analysis",
    group: "agents",
    agent: "radar",
    title: "市场趋势分析",
    description: "基于排行榜抓取结果生成市场趋势总结。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/radar.ts",
      startMarker: "const systemPrompt = `你是一个专业的网络小说市场分析师。",
      endMarker: "const response = await this.chat(",
      maxLines: 60,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "agents/radar.ts",
      startMarker: "{ role: \"user\", content: JSON.stringify(data, null, 2) }",
      endMarker: ");",
      maxLines: 6,
    }],
  },
  {
    id: "reviser.revise-chapter",
    group: "agents",
    agent: "reviser",
    title: "章节修订",
    description: "根据审计结果做定点修稿、润色、重作或反检测。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/reviser.ts",
      startMarker: "const systemPrompt = `${langPrefix}你是一位专业的",
      endMarker: "const userPrompt = `请修正第",
      maxLines: 80,
    }],
    userSources: [{
      label: "User Prompt",
      relativePath: "agents/reviser.ts",
      startMarker: "const userPrompt = `请修正第",
      endMarker: "const response = await this.chat(",
      maxLines: 40,
    }],
  },
  {
    id: "state-validator.validate-state",
    group: "agents",
    agent: "state-validator",
    title: "状态结算校验",
    description: "校验 settler/observer 产出的状态是否与正文一致。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/state-validator.ts",
      startMarker: "const systemPrompt = `You are a continuity validator",
      endMarker: "const userPrompt = `Chapter ${chapterNumber} validation:",
      maxLines: 45,
    }],
    userSources: [{
      label: "User Prompt",
      relativePath: "agents/state-validator.ts",
      startMarker: "const userPrompt = `Chapter ${chapterNumber} validation:",
      endMarker: "const response = await this.chat(",
      maxLines: 40,
    }],
  },
  {
    id: "title.refine-chapter",
    group: "agents",
    agent: "title-refiner",
    title: "章节标题复审与重命名",
    description: "基于 book rules、章节正文和全量历史标题，对章节标题做最终复审、重命名和批量修正。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "agents/title-refiner.ts",
      startMarker: "const systemPrompt = isEnglish",
      endMarker: "const userPrompt = isEnglish",
      maxLines: 90,
    }],
    userSources: [{
      label: "User Prompt",
      relativePath: "agents/title-refiner.ts",
      startMarker: "const userPrompt = isEnglish",
      endMarker: "const prompts = await this.applyPromptOverride(",
      maxLines: 60,
    }],
  },
  {
    id: "writer.creative-draft",
    group: "agents",
    agent: "writer",
    title: "正文写作",
    description: "Writer 主创作 prompt。system 由 writer-prompts 组装，user 会根据 legacy/v2 模式切换。",
    systemSources: [{
      label: "System Prompt Builder",
      relativePath: "agents/writer-prompts.ts",
      startMarker: "export function buildWriterSystemPrompt(",
      endMarker: "function buildChineseProtagonistIdentityBlock(",
      maxLines: 220,
    }],
    userSources: [
      {
        label: "Legacy User Prompt Builder",
        relativePath: "agents/writer.ts",
        startMarker: "private buildUserPrompt(params:",
        endMarker: "private buildGovernedUserPrompt(",
        maxLines: 120,
      },
      {
        label: "V2 Governed User Prompt Builder",
        relativePath: "agents/writer.ts",
        startMarker: "private buildGovernedUserPrompt(params:",
        endMarker: "private parseChapter(",
        maxLines: 160,
      },
    ],
  },
  {
    id: "writer.observe-chapter",
    group: "agents",
    agent: "observer",
    title: "章节观察者",
    description: "从正文里提取角色、资源、关系、时间等观察结果。",
    systemSources: [{
      label: "System Prompt Builder",
      relativePath: "agents/observer-prompts.ts",
      startMarker: "export function buildObserverSystemPrompt(",
      endMarker: "export function buildObserverUserPrompt(",
      maxLines: 140,
    }],
    userSources: [{
      label: "User Prompt Builder",
      relativePath: "agents/observer-prompts.ts",
      startMarker: "export function buildObserverUserPrompt(",
      maxLines: 80,
    }],
  },
  {
    id: "writer.settle-state",
    group: "agents",
    agent: "settler",
    title: "状态结算器",
    description: "把观察结果、原 truth files 和正文结算成结构化状态更新。",
    systemSources: [{
      label: "System Prompt Builder",
      relativePath: "agents/settler-prompts.ts",
      startMarker: "export function buildSettlerSystemPrompt(",
      endMarker: "export function buildSettlerUserPrompt(params:",
      maxLines: 190,
    }],
    userSources: [{
      label: "User Prompt Builder",
      relativePath: "agents/settler-prompts.ts",
      startMarker: "export function buildSettlerUserPrompt(params:",
      maxLines: 140,
    }],
  },
  {
    id: "interaction.develop-book-draft",
    group: "interaction",
    agent: "interaction-tools",
    title: "建书草案助手",
    description: "在自然语言建书流程中，逐轮补全书籍草案并追问下一步。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "interaction/project-tools.ts",
      startMarker: "const draftSystemPrompt = [",
      endMarker: "const draftUserPrompt = JSON.stringify({",
      maxLines: 20,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "interaction/project-tools.ts",
      startMarker: "const draftUserPrompt = JSON.stringify({",
      endMarker: "const draftPrompts = await applyPromptOverridePair(",
      maxLines: 12,
    }],
  },
  {
    id: "interaction.chat",
    group: "interaction",
    agent: "interaction-tools",
    title: "终端对话助手",
    description: "没有工具调用时的简短对话助手，回答当前工作台问题。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "interaction/project-tools.ts",
      startMarker: "const chatSystemPrompt = [",
      endMarker: "const chatUserPrompt =",
      maxLines: 12,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "interaction/project-tools.ts",
      startMarker: "const chatUserPrompt =",
      endMarker: "const chatPrompts = await applyPromptOverridePair(",
      maxLines: 8,
    }],
  },
  {
    id: "pipeline.agent-loop",
    group: "pipeline",
    agent: "agent-loop",
    title: "工具调用总控 Agent",
    description: "自然语言 Agent 模式下的 tool-use 调度总提示词。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "pipeline/agent.ts",
      startMarker: "const systemPrompt = `你是 InkOS 小说写作 Agent。",
      endMarker: "const prompts = await applyPromptOverridePair(",
      maxLines: 120,
    }],
  },
  {
    id: "pipeline.style-guide",
    group: "pipeline",
    agent: "runner",
    title: "文风指南生成",
    description: "分析参考文本并产出 style_guide.md 的定性描述。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "pipeline/runner.ts",
      startMarker: "const styleGuideSystemPrompt = `你是一位文学风格分析专家。",
      endMarker: "const styleGuideUserPrompt =",
      maxLines: 40,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "pipeline/runner.ts",
      startMarker: "const styleGuideUserPrompt =",
      endMarker: "const styleGuidePrompts = await applyPromptOverridePair(",
      maxLines: 8,
    }],
  },
  {
    id: "pipeline.parent-canon",
    group: "pipeline",
    agent: "runner",
    title: "正传正典参照生成",
    description: "从正传全套 truth files 生成 parent_canon.md，供番外使用。",
    systemSources: [{
      label: "System Prompt",
      relativePath: "pipeline/runner.ts",
      startMarker: "const parentCanonSystemPrompt = `你是一位网络小说架构师。基于正传的全部设定和状态文件",
      endMarker: "const parentCanonUserPrompt =",
      maxLines: 60,
    }],
    userSources: [{
      label: "User Payload",
      relativePath: "pipeline/runner.ts",
      startMarker: "const parentCanonUserPrompt =",
      endMarker: "const parentCanonPrompts = await applyPromptOverridePair(",
      maxLines: 10,
    }],
  },
] as const;

async function findExistingSourcePath(relativePath: string): Promise<string | null> {
  const candidates = [
    join(PACKAGE_ROOT, "src", relativePath),
    join(PACKAGE_ROOT, "dist", relativePath.replace(/\.ts$/u, ".js")),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function extractPromptSnippet(source: PromptCatalogSource): Promise<PromptCatalogSnippet | null> {
  const filePath = await findExistingSourcePath(source.relativePath);
  if (!filePath) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/u);
    const startIndex = lines.findIndex((line) => line.includes(source.startMarker));
    if (startIndex < 0) {
      return null;
    }

    let endIndexExclusive = Math.min(lines.length, startIndex + (source.maxLines ?? 80));
    if (source.endMarker) {
      const relativeEnd = lines
        .slice(startIndex + 1)
        .findIndex((line) => line.includes(source.endMarker!));
      if (relativeEnd >= 0) {
        endIndexExclusive = startIndex + 1 + relativeEnd;
      }
    }

    return {
      ...source,
      file: relative(PACKAGE_ROOT, filePath).replace(/\\/gu, "/"),
      content: lines.slice(startIndex, endIndexExclusive).join("\n").trim(),
    };
  } catch {
    return null;
  }
}

export function listPromptCatalog(): ReadonlyArray<PromptCatalogEntry> {
  return PROMPT_CATALOG;
}

export async function readPromptCatalogWithSnippets(): Promise<ReadonlyArray<PromptCatalogEntryWithSnippets>> {
  const entries = await Promise.all(
    PROMPT_CATALOG.map(async (entry) => {
      const [systemSnippets, userSnippets] = await Promise.all([
        Promise.all((entry.systemSources ?? []).map((source) => extractPromptSnippet(source))),
        Promise.all((entry.userSources ?? []).map((source) => extractPromptSnippet(source))),
      ]);

      return {
        ...entry,
        systemSnippets: systemSnippets.filter((snippet): snippet is PromptCatalogSnippet => Boolean(snippet)),
        userSnippets: userSnippets.filter((snippet): snippet is PromptCatalogSnippet => Boolean(snippet)),
      };
    }),
  );

  return entries;
}
