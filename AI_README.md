# AI_README

这份文档是给后续 AI / 新同学的首读索引。遵循三条原则：

1. 现状优先：只记录当前仓库已经落地的行为。
2. 代码为准：和文档冲突时，以 `packages/core` / `packages/cli` 的实现为准。
3. 分层记录：先讲系统全貌，再给入口文件和改动点。

## 1. 项目现状

这是一个以小说生产流水线为核心的 monorepo，当前目标不是“半自动辅助写作”，而是把 InkOS 改成“可持续推进的全自动写作模式”。

- 根目录：
  - `README.md` / `README.en.md` / `README.ja.md`：产品说明。
  - `CHANGELOG.md`：版本变更。
  - `test-project/inkos.json`：最小示例配置。手改时保持单个顶层 `daemon` 对象；若只配置部分 `daemon` 字段，schema 会自动补齐默认 `schedule`。
- `packages/core`：真正的业务内核，包含写作、审计、修订、状态落盘、守护调度。
- `packages/cli`：命令行入口，`inkos up/down/write/audit/revise/review` 都从这里接入核心包。
- `packages/studio`：Web 工作台。

## 2. 当前最重要的业务差异

### 2.1 全自动 `inkos up`

代码入口：

- `packages/cli/src/commands/daemon.ts`
- `packages/core/src/pipeline/scheduler.ts`
- `packages/core/src/pipeline/runner.ts`

当前实现下，`inkos up` 的自动推进规则是：

1. 守护进程每次准备写新章节前，先检查历史章节是否都已经是“通过”状态。
2. 对守护模式来说，“通过”状态以 chapter index 里的 `approved` / `published` / `imported` 为准。
3. 如果发现历史章节仍是 `ready-for-review`、`audit-failed` 等未通过状态，不会直接写下一章。
4. 守护进程会先对这些章节执行补审；审计不通过时执行自动修订；修订后再看是否通过。
5. 一旦审计通过，守护进程会自动把章节状态改成 `approved`，然后才继续推进下一章。
6. 当前默认会为同一章保留 20 次自动重试预算；若连续第 21 次仍失败，才会触发暂停。

也就是说，`up` 模式已经不再依赖人工执行 `review approve` 才能继续跑。

补充：

- 手动 `inkos write next` 也已经接上同样的前置护栏。只要历史里还存在不是 `approved` / `published` / `imported` 的章节，就不会继续往后写。
- `review approve` 不再只是改 chapter index；如果目标章节是 `audit-failed`，会先把 staged truth promote 到正式 `story/*`，再更新 snapshot 与记忆索引。
- Studio 里的章节 `Approve` / `Approve All` 现在也改成直接走 `PipelineRunner.approveChapter()` / `approveAllPendingChapters()`，不再只是前端改 chapter index 状态。
- 守护器自动批准章节时，也统一走 `PipelineRunner.approveChapter()`。这样 `audit-failed -> approved` 不会只改 `chapters/index.json`，而是会同时提交 staged truth、刷新 snapshot 与记忆索引。
- Studio 里的章节 `Reject` 现在改走 `PipelineRunner.rejectChapter()`。对于老项目里“最新章是 `audit-failed`，但上一章快照缺失”的情况，会自动退化成“先裁掉失败章，再把上一章当最新章做一次 truth sync”来重建状态；对其他回滚场景仍保持原来的严格快照恢复。
- 对于 401/403、Anthropic 鉴权缺失、明显的模型缺失或 baseUrl 错配等非重试型运行错误，守护器会立即暂停该书；普通 400 不再直接判死，而是保留重试并把原始错误文本写进日志，方便继续判断是字段兼容、上下文长度还是内容审查问题。
- provider 层不再区分 Kimi 专用温度钳制；现在统一使用全局温度上限 `<= 1.0`。scheduler 的 retry temperature 也同步封顶到 `1.0`，从源头避免把请求温度抬过接口上限。
- provider 层现在会在单次 API 调用内部自动重试瞬时上游错误（如 `429`、`529`、`502/503/504`、超时、连接重置），优先在当前环节内消化波动，避免直接把整章流水线从头重跑。

### 2.2 审计门槛

代码入口：

- `packages/core/src/agents/continuity.ts`
- `packages/core/src/pipeline/chapter-review-cycle.ts`

当前审计结论不是只信 LLM 返回的 `passed`，而是代码层会做二次裁决。现行门槛如下：

- 只要存在任何 `critical` 问题，拒绝。
- 只要存在任何会污染长期故事状态的 `warning`，拒绝。
- 存在 6 个或更多普通 `warning`，拒绝。
- 只有 `info`，或仅有 1 个轻微表面 warning 时，通常通过。

当前被视为“污染长期状态”的 warning，重点看这些方向：

- 时间线矛盾
- 设定 / 正史 / 世界规则漂移
- 战力体系或资源设定不一致
- POV 知识泄露
- 角色动机或关系连续性断裂

补充说明：

- 审计问题现在统一落盘为 `"[severity] category: description"` 格式，便于统计、重复警告判定和后续排查。
- `write next` 的前向审计现在不再只看磁盘里的旧 `current_state.md`。review cycle 会把本章正文重新 settle 后的候选 truth 一并送进 auditor，并在 prompt 里显式区分“官方章前 truth”和“候选章后 truth”，避免把章末状态误当成章初状态。
- 手动 `reviseDraft` 修订 `audit-failed` 章节时，会优先读取 `.review-staging/chapter-XXXX/story/*` 里的候选 truth 作为章后真相，再做修订前审计；没有 staged truth 时才退回只读正式 `story/*`。
- `write next` 的审计失败后，不再只对 `critical` 自动修；只要是阻断性 `warning` / `critical`，都会尝试进入一次自动修订。
- 自动修订不再永远死锁在 `spot-fix`：如果命中 `大纲偏离检测`、`读者期待管理`、世界规则漂移、时间线矛盾、角色动机/关系连续性断裂等结构性问题，会自动升级到 `rework`；若同一章连续失败已到 4 次，或同时出现多个结构性 `critical`，会直接升级到 `rewrite`。
- 多模型路由里，运行时实际识别的章节审计和修订键名是 `auditor` 与 `reviser`。无人值守场景推荐把两者拆开：`auditor` 用更严格、更稳定的审计模型，`reviser` 用更强的长文改写模型。
- `writer` 的全局写作规则（核心规则、硬性禁令、文风/书规）现在也会注入给 `reviser` 与 `length-normalizer`，不再只有 `writer` 独享完整写作护栏。

### 2.3 提示词现在可集中查看和项目级覆盖

代码入口：

- `packages/core/src/prompts/catalog.ts`
- `packages/core/src/prompts/overrides.ts`
- `packages/studio/src/pages/PromptManager.tsx`
- `packages/studio/src/api/server.ts`
- `packages/core/src/llm/tracing.ts`

当前实现下，InkOS 里真正发给模型的主要 prompt 入口，已经被整理成一份可读目录，并暴露给 Studio 页面：

- agents：`architect.*`、`chapter-analyzer.extract-state`、`consolidator.volume-summary`、`continuity.audit-chapter`、`fanfic-canon-importer.import-canon`、`foundation-reviewer.review-foundation`、`length-normalizer.normalize-length`、`radar.market-analysis`、`reviser.revise-chapter`、`state-validator.validate-state`、`title.refine-chapter`、`writer.creative-draft`、`writer.observe-chapter`、`writer.settle-state`
- interaction：`interaction.develop-book-draft`、`interaction.chat`
- pipeline：`pipeline.agent-loop`、`pipeline.style-guide`、`pipeline.parent-canon`

Studio 里新增了“提示词”页，能力有两类：

1. 直接查看每个入口对应的 system / user prompt 源码片段。
2. 对单个 prompt 做项目级 override。

override 的持久化位置：

- 写入 `inkos.json` 顶层的 `promptOverrides`
- 支持 `append` 和 `replace`
- `append` 是在解析后的 prompt 后追加文本
- `replace` 是整段替换掉原 prompt

注意：

- 当前覆盖是“项目级”的，不是全局配置。
- 页面展示的是当前代码里真实使用的 prompt 入口，不是随便手填的一份文档清单。

### 2.4 日志现在分成“流程日志”和“AI 原文日志”

代码入口：

- `packages/cli/src/commands/daemon.ts`
- `packages/studio/src/api/server.ts`
- `packages/core/src/llm/tracing.ts`

当前实现：

- CLI `inkos up` 和 Studio 内触发的守护/写作流程，都会把结构化流程日志追加到项目根目录 `inkos.log`
- 所有已接入 tracing 的 LLM 环节，都会把原始 request / response / error 追加到项目根目录 `inkos-ai.log`
- `inkos-ai.log` 采用 JSON Lines；每条记录会带上 `phase`、`agent`、`promptId`、`bookId`、`messages`、`content`、`error`
- Studio 的“日志”页现在分成两个标签：
  - `流程日志`：读取 `/api/logs` → `inkos.log`
  - `AI 原文`：读取 `/api/ai-logs` → `inkos-ai.log`

当前已经接入 raw trace 的主要路径：

- 所有基于 `BaseAgent` 的 writer / auditor / reviser / title-refiner / chapter-analyzer 等 agent
- `interaction.develop-book-draft`
- `interaction.chat`
- `pipeline.style-guide`
- `pipeline.parent-canon`
- `pipeline.agent-loop`

## 3. 核心流程图谱

### 3.1 写下一章

- CLI 入口：`packages/cli/src/commands/write.ts`
- 核心执行：`packages/core/src/pipeline/runner.ts`
- 审计/修订循环：`packages/core/src/pipeline/chapter-review-cycle.ts`
- 最终落盘：`packages/core/src/pipeline/chapter-persistence.ts`

典型链路：

1. `writeNextChapter()`
2. 若最新章节已经是 `approved`，但 `current_state.md` / `chapter_summaries.md` / `emotional_arcs.md` / snapshot 仍落后，会先自动对最新已批准章做一次 truth sync，再重新 approve，避免踩着过期状态写下一章。
3. Planner / Composer 生成治理输入
4. Writer 产出正文
5. Title Refiner 读取 `book_rules` + 全量历史标题，对章节标题做最终复审，禁止本地机械补尾式改名
6. Auditor 审计
7. 若存在阻断性问题，则进入 Reviser
8. 若最终状态是 `ready-for-review`，正式 truth files / snapshot 一次性落盘
9. 若最终状态是 `audit-failed`，章节正文会落盘，但候选 truth 只进 review staging，不覆盖正式 `story/*`

补充：

- `current_focus.md` 不再只在建书时初始化一次。只要“最新章节”正式向前推进，runner 就会为“下一章”重新生成 focus 并覆盖 `story/current_focus.md`。这条刷新路径已覆盖：正常写章通过、手动 revise 后通过、`repair-state` / `sync` 成功、import replay 完成，以及 `review approve` / `approve-all` 提交最新章节的 staged truth。
- `current_focus.md` 现在改成本地轻量刷新，不再为此额外调用一次 planner。它主要复用 `story/runtime/chapter-XXXX.intent.md` 里的最近 intent 信息来滚动到“下一章”，从而避免一边写章一边多耗一次规划调用。
- `particle_ledger.md` 现在有“失管检测”。当账本长期停留在初始化/占位状态，而当前题材又启用了数值体系时，流水线会优先复用本次 settle 或 final analyzer 已经产出的账本结果来修复；只有仍拿不到有效账本时，才额外回退到一次 analyzer 重建，尽量减少 API 调用。
- `chapter_summaries.md` 的写入现在额外做“当前章节摘要补写”。即使本次状态结算走的是结构化 runtime delta，也会用 delta 渲染当前章摘要并按章节号去重追加，避免长篇运行后摘要表只停在早期章节。
- `write sync` / 写前自愈现在会检测辅助真相文件缺口：如果 `chapter_summaries.md` 或 `story/state/chapter_summaries.json` 少了历史章节，或者 `emotional_arcs.md` 长期停在早期章节，会复用 `chapter-analyzer` 按缺失章节逐章回填；同一轮分析会同时补摘要和情绪弧线，避免为两个文件重复调用模型。
- Reviser / Auditor 现在共享一份“多章连续性包”：默认会带 `N-1` 全文、若存在则带 `N+1` 开头片段，再附上 `N-3..N+1` 的章节摘要轨迹。目的不是只修上一章衔接，而是同时防止把已存在后文的事实回写坏。
- Reviser 在自动修订和手动修订时也会收到 truth context：正式 `story/*` 是“章前官方真相”，候选 settled truth 或 staged truth 是“章后修订目标”。提示词会明确要求模型不要把候选章后状态当成章节开头事实。
- 只要正文在审计链路里被改过（spot-fix / rewrite / rework / 最后一轮本地阻断修补），runner 都会先对“改后的正文”重新 settle truth，再进入下一轮 audit 或持久化，避免正文和候选 state/hooks/ledger 半同步。
- Studio 的 Truth Files 页面保存后，不再只是覆盖 `story/*.md` 文件；现在会按文件类型触发本地零额外模型调用的后续同步，例如叙事记忆索引、结构化状态镜像、`current_state` 事实历史和最新章节快照。
- 最终正文在落盘前会再跑一轮本地阻断校验：如果修订后又引入了“第X章”元叙事、角色讨论自己处在第几章、禁用句式等硬错误，会触发一次额外的 spot-fix，并重新合并审计结果，避免这类错误直接漏进正式章节。
- 章节正文文件在落盘前会清洗顶部残留 heading。无论是写新章、修订章节还是批量重命名，都会先剥掉正文里残留的旧标题，再统一写入新的正式标题，避免出现“双标题”开头。

### 3.2 守护调度

- 调度器：`packages/core/src/pipeline/scheduler.ts`
- 守护命令：`packages/cli/src/commands/daemon.ts`

调度器负责三件事：

1. 定时选书并发起写作
2. 在写新章前清理历史未通过章节
3. 对通过审计的章节自动 approve，并处理失败计数/暂停逻辑
4. 若写作尝试在审计前就抛异常，额外输出明确的 runtime error 日志；Studio 守护页会直接显示 `daemon:error` 的错误文本，不再只显示书名
5. 对于瞬时上游请求错误（`429` / `529` / `502/503/504` / 超时 / 连接重置），调度器不再立刻把它记进审计失败预算并原地重跑整章；provider 会先在当前调用内重试，若仍失败，则把这次写作延后到下一次 scheduler tick。

当前默认阈值：

- `daemon.qualityGates.maxAuditRetries = 20`
- `daemon.qualityGates.pauseAfterConsecutiveFailures = 21`
- 也就是 20 次失败仍继续自动重试，第 21 次连续失败才暂停

## 4. 关键文件速查

- `packages/core/src/agents/continuity.ts`
  - 审计 prompt、解析、代码层审核门槛都在这里；当前二次裁决是固定脚本，不再包含“连续两章重复 warning 直接驳回”的规则。
- `packages/core/src/agents/planner.ts`
  - 负责常规章节规划；但 `current_focus.md` 的自动刷新本身已经不再额外调用 planner。
- `packages/core/src/pipeline/chapter-review-cycle.ts`
  - 控制“先审、失败则修、修后再审”的自动循环；现在会在正文变化后重新 settle 候选 truth，并把它作为章后 truth 传给 auditor。
- `packages/core/src/pipeline/revision-strategy.ts`
  - 根据问题类型和连续失败次数，决定该用 `spot-fix`、`rework` 还是 `rewrite`。
- `packages/core/src/pipeline/scheduler.ts`
  - `inkos up` 的自动推进规则在这里。
- `packages/core/src/pipeline/runner.ts`
  - 单章完整流水线、手动 `auditDraft` / `reviseDraft` / `writeNextChapter` 的主入口；同时负责“已批准章节但 truth files 落后”的写前自愈、历史摘要/情绪弧线缺口回填、`current_focus.md` 自动滚动、`particle_ledger.md` 的失管检测/低调用量回填、正文变化后的 truth 重结算、Truth Files 手改后的本地同步，以及 Studio/后续 CLI 共用的 `rejectChapter()` 回退恢复逻辑。
- `packages/core/src/utils/chapter-continuity-pack.ts`
  - 多章连续性上下文装配器。给 auditor / reviser 统一提供上一章全文、下一章开头片段和邻近章节摘要轨迹。
- `packages/core/src/utils/length-metrics.ts`
  - 章节长度区间的计算入口。现在会优先读取项目配置里的 `lengthGovernance.range.softRatio / hardRatio`，默认值仍保持旧版区间。
- `packages/core/src/pipeline/chapter-persistence.ts`
  - chapter index 写入格式，以及 `ready-for-review` / `audit-failed` / `state-degraded` 三种落盘分流。
- `packages/core/src/agents/title-refiner.ts`
  - 章节标题专用复审与重命名 agent。会吃 `book_rules` 正文、章节内容和全量历史标题，并额外感知“历史高频标题词压力”，强制避免“旧标题+补尾”的机械改名，以及长期复用“铜币 / 倒计时 / 门 / 钥匙”这类旧高频词壳。
- `packages/core/src/agents/post-write-validator.ts`
  - 本地零调用校验器。这里会把“正文里出现第X章/Chapter X 指称”直接视为 `critical` 级本地错误，并在审计前/落盘前强制进入 spot-fix。
- `packages/core/src/pipeline/chapter-state-recovery.ts`
  - `state-degraded` 的降级保存与恢复元数据。
- `packages/core/src/state/manager.ts`
  - review staging 的目录结构、promote/discard、rollback 时的清理；额外提供 `discardChaptersAfter()` 给上层 reject 恢复链路复用。
- `packages/cli/src/commands/review.ts`
  - 手动 `approve` / `approve-all` 现在会真正提交 staged truth，而不只是改状态。
- `packages/cli/src/commands/write.ts`
  - 新增 `inkos write retitle`，可单章或按区间批量重命名章节标题，并同步 `chapters/index.json`、章节正文首行、`chapter_summaries.*` 和快照里的标题。
- `packages/cli/src/commands/daemon.ts`
  - 守护进程启动/停止与完成日志输出。
- `packages/core/src/prompts/catalog.ts`
  - 所有 prompt 入口的目录定义，以及源码片段提取规则。
- `packages/core/src/prompts/overrides.ts`
  - `inkos.json.promptOverrides` 的读取与 append/replace 应用逻辑。
- `packages/core/src/llm/tracing.ts`
  - 原始 LLM 请求/响应日志的统一追加器；负责把 request/response/error 写进项目根目录 `inkos-ai.log`。
- `packages/studio/src/pages/PromptManager.tsx`
  - 提示词工作台页面：查看源码片段、编辑 override。
- `packages/studio/src/api/server.ts`
  - `/api/project/prompts` 的读写接口；章节 approve / approve-all 已改走 core 审批流程；Truth Files 保存后会调用 core 的 truth-edit 同步入口；`/api/logs` / `/api/ai-logs` 分别暴露流程日志和 AI 原文日志。
- `packages/cli/src/commands/studio.ts`
  - Studio 启动入口。Windows 下源码模式需要把 `tsx` loader 通过 `file://` URL 传给 `node --import`，但主入口 `.ts` 仍保持普通路径。
- `scripts/pack-release.mjs`
  - 仓库级本地打包入口：先 `build` + `verify:publish-manifests`，再依次打出 core/studio/cli 的 npm tarball 到 `tmp/release-packages/`。
- `scripts/restore-package-json.mjs`
  - 发布清单恢复脚本。`npm pack` 后立即恢复；`npm publish` 时会跳过 `postpack`，等到 `postpublish` 再恢复，避免 registry 元数据继续保留 `workspace:*`。
- `.github/workflows/ci.yml`
  - PR / push 时会额外校验 `packages/core`、`packages/studio`、`packages/cli` 的 tarball，提前拦截发布清单问题。
- `.github/workflows/release.yml`
  - 推送 `v*` tag 后执行正式发布：先测试和 smoke test，再发布 canary，校验通过后再发 latest。

## 5. 开发与验证

当前在这台机器上，核心包可以正常验证：

```bash
npx pnpm install --frozen-lockfile
npx pnpm --filter @jiejingtazhu/inkos-core build
npx pnpm --filter @jiejingtazhu/inkos-core typecheck
npx pnpm --filter @jiejingtazhu/inkos-core test
```

已确认通过的本次改动相关验证：

- `@jiejingtazhu/inkos-core` `typecheck`
- `@jiejingtazhu/inkos-core` 全量 `vitest`
- `@jiejingtazhu/inkos-studio` `typecheck`
- `@jiejingtazhu/inkos-studio` `vitest`
- `@jiejingtazhu/inkos` `typecheck`
- `@jiejingtazhu/inkos` `studio-runtime.test.ts` / `studio.test.ts`
- `@jiejingtazhu/inkos` `publish-package.test.ts`（Windows）
- `npx pnpm release:pack`（Windows，本地成功打出 core/studio/cli 三个 tarball）
- Windows 本机实测：`node ..\\packages\\cli\\dist\\index.js studio --port 4571` 可返回 `HTTP 200`

当前本地环境里的已知问题：

- 这台 Windows 机器的 PowerShell 当前没有把 `pnpm` 直接放进 PATH；需要时可用 `npx pnpm ...` 代替。
- `packages/studio` 打包时仍会打印 Vite 的大 chunk warning，但这是构建提示，不会阻断 `release:pack` 或 npm 发包。

补充：如果要放宽字数区间，不用再改代码常量，直接在 `inkos.json` 顶层加：

```json
{
  "lengthGovernance": {
    "range": {
      "softRatio": 0.3,
      "hardRatio": 0.4
    }
  }
}
```

- `softRatio` 决定触发归一化的区间
- `hardRatio` 决定“归一化后仍算超标”的警告区间
- 默认值保持旧版行为：`softRatio ≈ 0.136`、`hardRatio ≈ 0.273`

补充：当前仓库已经有一条更适合发布前自检的本地链路：

```bash
pnpm release:check
pnpm release:pack
```

- `release:check`：构建整个 workspace，并校验发布时的 manifest 可被正确归一化。
- `release:pack`：在 `release:check` 基础上，额外打出 core/studio/cli 三个 npm tarball。

### 5.1 Git / npm 发布链路

当前仓库要实现“像原版一样一行安装”，靠的是：

1. GitHub 托管源码
2. npm 托管可安装 CLI 包

也就是说：

- 只 push Git，不会自动得到可安装 CLI。
- 真正的“一行安装”依赖 `packages/cli` 发布成 npm 包。
- 仓库已经内置 tag 触发发布流：推送 `v1.2.0` 这类 tag 后，`.github/workflows/release.yml` 会按 `core -> studio -> cli` 顺序发包。

如果后续要发自己的 fork，先检查：

- `packages/core/package.json`
- `packages/studio/package.json`
- `packages/cli/package.json`

尤其是：

- `name`
- `repository.url`
- `repository.directory`

如果不改包名，默认还是往当前 `@jiejingtazhu/*` 包名上发布，需要对应 npm 权限。

## 6. 文档维护约定

后续如果继续改这些点，记得同步更新本文件：

- 审计拒绝标准
- `inkos up` 自动推进规则
- `daemon.qualityGates` 默认值或语义
- 自动修订模式的升级条件
- chapter status 的含义或新增状态
- 正式 truth files 与 review staging 的分工
- chapter index 中 `auditIssues` 的格式
- 守护进程是否仍需要人工 approve
- `review approve` 是否仍然承担 staged truth promote
- prompt 目录是否新增/删除入口
- `promptOverrides` 的存储格式或覆盖语义
- `inkos.log` / `inkos-ai.log` 的写入位置、格式或可见入口
- Studio 提示词页/API 的入口位置
- 本地打包命令、CI 打包校验或 tag 发布流程

## 7. 本次初始化记录

- 初始化日期：`2026-04-15`
- 初始化原因：仓库此前没有 `AI_README.md`，本次在完成“全自动补审 + 自动 approve”改造后补齐项目索引
