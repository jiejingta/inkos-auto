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

### 2.2 审计门槛

代码入口：

- `packages/core/src/agents/continuity.ts`
- `packages/core/src/pipeline/chapter-review-cycle.ts`

当前审计结论不是只信 LLM 返回的 `passed`，而是代码层会做二次裁决。现行门槛如下：

- 只要存在任何 `critical` 问题，拒绝。
- 只要存在任何会污染长期故事状态的 `warning`，拒绝。
- 存在 3 个或更多普通 `warning`，拒绝。
- 相同 warning 类别在连续 2 章重复出现，拒绝。
- 只有 `info`，或仅有 1 个轻微表面 warning 时，通常通过。

当前被视为“污染长期状态”的 warning，重点看这些方向：

- 时间线矛盾
- 设定 / 正史 / 世界规则漂移
- 战力体系或资源设定不一致
- POV 知识泄露
- 角色动机或关系连续性断裂

补充说明：

- 审计问题现在统一落盘为 `"[severity] category: description"` 格式，便于统计、重复警告判定和后续排查。
- `write next` 的审计失败后，不再只对 `critical` 自动修；只要是阻断性 `warning` / `critical`，都会尝试进入一次自动修订。
- 自动修订不再永远死锁在 `spot-fix`：如果命中 `大纲偏离检测`、`读者期待管理`、世界规则漂移、时间线矛盾、角色动机/关系连续性断裂等结构性问题，会自动升级到 `rework`；若同一章连续失败已到 4 次，或同时出现多个结构性 `critical`，会直接升级到 `rewrite`。
- 多模型路由里，运行时实际识别的章节审计和修订键名是 `auditor` 与 `reviser`。无人值守场景推荐把两者拆开：`auditor` 用更严格、更稳定的审计模型，`reviser` 用更强的长文改写模型。

### 2.3 提示词现在可集中查看和项目级覆盖

代码入口：

- `packages/core/src/prompts/catalog.ts`
- `packages/core/src/prompts/overrides.ts`
- `packages/studio/src/pages/PromptManager.tsx`
- `packages/studio/src/api/server.ts`

当前实现下，InkOS 里真正发给模型的主要 prompt 入口，已经被整理成一份可读目录，并暴露给 Studio 页面：

- agents：`architect.*`、`chapter-analyzer.extract-state`、`consolidator.volume-summary`、`continuity.audit-chapter`、`fanfic-canon-importer.import-canon`、`foundation-reviewer.review-foundation`、`length-normalizer.normalize-length`、`radar.market-analysis`、`reviser.revise-chapter`、`state-validator.validate-state`、`writer.creative-draft`、`writer.observe-chapter`、`writer.settle-state`
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

## 3. 核心流程图谱

### 3.1 写下一章

- CLI 入口：`packages/cli/src/commands/write.ts`
- 核心执行：`packages/core/src/pipeline/runner.ts`
- 审计/修订循环：`packages/core/src/pipeline/chapter-review-cycle.ts`
- 最终落盘：`packages/core/src/pipeline/chapter-persistence.ts`

典型链路：

1. `writeNextChapter()`
2. Planner / Composer 生成治理输入
3. Writer 产出正文
4. Auditor 审计
5. 若存在阻断性问题，则进入 Reviser
6. Truth files / chapter index / snapshot 一次性落盘

### 3.2 守护调度

- 调度器：`packages/core/src/pipeline/scheduler.ts`
- 守护命令：`packages/cli/src/commands/daemon.ts`

调度器负责三件事：

1. 定时选书并发起写作
2. 在写新章前清理历史未通过章节
3. 对通过审计的章节自动 approve，并处理失败计数/暂停逻辑
4. 若写作尝试在审计前就抛异常，额外输出明确的 runtime error 日志；Studio 守护页会直接显示 `daemon:error` 的错误文本，不再只显示书名

当前默认阈值：

- `daemon.qualityGates.maxAuditRetries = 20`
- `daemon.qualityGates.pauseAfterConsecutiveFailures = 21`
- 也就是 20 次失败仍继续自动重试，第 21 次连续失败才暂停

## 4. 关键文件速查

- `packages/core/src/agents/continuity.ts`
  - 审计 prompt、解析、代码层审核门槛、重复 warning 判定都在这里。
- `packages/core/src/pipeline/chapter-review-cycle.ts`
  - 控制“先审、失败则修、修后再审”的自动循环。
- `packages/core/src/pipeline/revision-strategy.ts`
  - 根据问题类型和连续失败次数，决定该用 `spot-fix`、`rework` 还是 `rewrite`。
- `packages/core/src/pipeline/scheduler.ts`
  - `inkos up` 的自动推进规则在这里。
- `packages/core/src/pipeline/runner.ts`
  - 单章完整流水线、手动 `auditDraft` / `reviseDraft` / `writeNextChapter` 的主入口。
- `packages/core/src/pipeline/chapter-persistence.ts`
  - chapter index 写入格式、状态、审计问题字符串落盘。
- `packages/core/src/pipeline/chapter-state-recovery.ts`
  - `state-degraded` 的降级保存与恢复元数据。
- `packages/cli/src/commands/daemon.ts`
  - 守护进程启动/停止与完成日志输出。
- `packages/core/src/prompts/catalog.ts`
  - 所有 prompt 入口的目录定义，以及源码片段提取规则。
- `packages/core/src/prompts/overrides.ts`
  - `inkos.json.promptOverrides` 的读取与 append/replace 应用逻辑。
- `packages/studio/src/pages/PromptManager.tsx`
  - 提示词工作台页面：查看源码片段、编辑 override。
- `packages/studio/src/api/server.ts`
  - `/api/project/prompts` 的读写接口。
- `packages/cli/src/commands/studio.ts`
  - Studio 启动入口。Windows 下源码模式需要把 `tsx` loader 通过 `file://` URL 传给 `node --import`，但主入口 `.ts` 仍保持普通路径。

## 5. 开发与验证

当前在这台机器上，核心包可以正常验证：

```bash
npx pnpm install --frozen-lockfile
npx pnpm --filter @actalk/inkos-core build
npx pnpm --filter @actalk/inkos-core typecheck
npx pnpm --filter @actalk/inkos-core test
```

已确认通过的本次改动相关验证：

- `@actalk/inkos-core` `typecheck`
- `@actalk/inkos-core` 全量 `vitest`
- `@actalk/inkos-studio` `typecheck`
- `@actalk/inkos-studio` `vitest`
- `@actalk/inkos` `typecheck`
- `@actalk/inkos` `studio-runtime.test.ts` / `studio.test.ts`
- Windows 本机实测：`node ..\\packages\\cli\\dist\\index.js studio --port 4571` 可返回 `HTTP 200`

当前本地环境里的已知问题：

- `@actalk/inkos` 的 `typecheck` 当前可通过；CLI 的 `studio-runtime.test.ts` / `studio.test.ts` 也可通过。
- `@actalk/inkos` 全量 `vitest` 在 Windows 下仍会被 `publish-package.test.ts` 里的 `tar --force-local` 不兼容拦住。
- `@actalk/inkos-studio` 的打包相关测试也会受同类 `tar` 兼容性影响。
- 这些问题都属于当前 Windows 打包链路兼容问题，不是本次 Studio 启动修复新增的业务失败。

## 6. 文档维护约定

后续如果继续改这些点，记得同步更新本文件：

- 审计拒绝标准
- `inkos up` 自动推进规则
- `daemon.qualityGates` 默认值或语义
- 自动修订模式的升级条件
- chapter status 的含义或新增状态
- chapter index 中 `auditIssues` 的格式
- 守护进程是否仍需要人工 approve
- prompt 目录是否新增/删除入口
- `promptOverrides` 的存储格式或覆盖语义
- Studio 提示词页/API 的入口位置

## 7. 本次初始化记录

- 初始化日期：`2026-04-15`
- 初始化原因：仓库此前没有 `AI_README.md`，本次在完成“全自动补审 + 自动 approve”改造后补齐项目索引
