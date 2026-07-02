# Article Embedded Resources Dev Plan

## Scope

本轮实现一个可发布的低干扰文章资源入口，覆盖 Brief 的低干扰入口与 Slash 插入模块：

- 移除文章标题附近的“相关资源”状态带。
- 移除正文底部“本篇资源”预览区。
- 音频改为文章工具栏 icon：基于当前文章生成朗读脚本，并直接打开 `ArtifactViewer`。
- 思维导图和报告改为 `/` 命令：生成后插入正文中的可折叠模块。
- 保留 `ResourcesPanel` 作为 notebook 级资源库与管理入口。
- 为新生成的 artifact 记录来源关联，使资源库仍可追踪文章来源。

## Current System

- `NoteEditor` 已经在正文区域内渲染摘要与文章批注，并通过顶部 `Layers` 按钮打开 `ResourcesPanel` overlay。
- `ResourcesPanel` 仍按资源库方式组织“内容生成 / 已生成 / 笔记”，适合管理 notebook 级资源。
- `ArtifactViewer` 已能承载 mindmap、report、audio 的完整消费；音频 icon 复用它做结果查看。
- `NovelEditor` 已有 slash command 基础能力，适合承接导图 / 报告的正文插入入口。

## Data Model

扩展现有 artifact 元数据，不新增独立表：

- `sourceIds?: string[]`：本次生成使用的 source id 列表。
- `primaryArticleId?: string`：当 artifact 从文章内入口生成时，记录主关联文章的 `NoteEntry.id`。

使用规则：

- 文章工具栏音频 icon 与 slash 命令都传入当前文章 source id 与 `primaryArticleId`。
- `ResourcesPanel` 继续展示 notebook 全量 artifact；文章正文不再按 article affinity 渲染资源卡。
- 旧 artifact 或 notebook 级 artifact 继续留在资源库层，不默认塞入文章正文。

## Backend Changes

- `src/services/notebook-service.ts`
  - 扩展 `Artifact` / `ArtifactSaveInput`，保存 `sourceIds` 与 `primaryArticleId`。
  - 保持旧 artifact JSON 兼容，字段可选。
- `src/services/notebook-ai.ts`
  - `generateMindMap`、`generateReport`、`generateAudioScript` 写入生成时的 `sourceIds` 与可选 `primaryArticleId`。
  - 默认模型解析改为 provider-aware：优先显式传入模型，其次选择已配置云 provider / Gemini ACP，最后才回退本地 `gemma`，避免未配置 Gemini 时生成空 artifact。
  - 构造 prompt 前会剥离正文里已插入的 `<details data-neo-generated-block>` 模块，避免导图 / 报告 / 音频把旧生成内容再次当作原文上下文。
  - 将 audio artifact 的脚本字段统一写为 `data.script`，viewer 仍兼容旧 `data.segments`。
  - `generateAudioScript` 支持 `audioMode`，文章工具栏入口固定走单人朗读模式，资源库级入口仍可保留对话式脚本能力。
  - mindmap 生成结果保存前规整为 markmap 可读 Markdown，兼容 JSON 树、列表和代码围栏输出。
  - audio artifact 写入 `durationSeconds`，并继续保存 `segments` 兼容旧消费路径。
- `src/routes/notebook-studio.ts`
  - `POST /api/notebook/artifact` 接收可选 `primaryArticleId`、`audioMode` 并传给生成层。

## Frontend Changes

- `packages/web/src/components/notebook/StudioActionModal.tsx`
  - 支持 `sourceIdsOverride` 与 `primaryArticleIdOverride`，供文章内入口强制基于当前文章生成。
  - 资源库入口仍沿用当前 `selectedSourceIds` 行为。
- `packages/web/src/components/notebook/studio/ArtifactViewer.tsx`
  - audio viewer 同时支持 `data.script` 与旧 `data.segments`。
  - mindmap / report viewer 兼容多种内容字段，音频 viewer 显示估算时长。
- `packages/web/src/components/NovelEditor.tsx`
  - 新增可序列化的折叠生成模块节点，使用 `<details data-neo-generated-block>` 持久化。
  - slash command 新增“生成思维导图”“生成报告”，先插入生成中模块，再用生成结果替换。
- `packages/web/src/components/NoteEditor.tsx`
  - 保留摘要块，隐藏后以轻量“摘要”按钮恢复。
  - 新增文章工具栏音频 icon，直接基于当前文章生成单人朗读音频。
  - 向 `NovelEditor` 注入导图 / 报告生成回调，生成结果插入正文折叠模块。
  - 不再渲染“相关资源”状态带和正文底部资源预览区。
- `packages/web/src/index.css`
  - 为生成插入模块补充轻量折叠样式。

## Documentation Updates

- `docs/user-guide/NOTEBOOK.md`：补充音频 icon 与 slash 插入模块。
- `docs/README.md`：功能文档索引加入 Article Embedded Resources。
- `docs/product/ROADMAP.md`：Web UI 增强增加文章内资源消费状态。
- `CHANGELOG.md`：Unreleased 增加本功能条目。
- `docs/features/article-embedded-resources/test-report.md`：记录验收覆盖、验证命令和风险。

## Testing Plan

- 后端单测：扩展 notebook artifact primitive，覆盖 `sourceIds` / `primaryArticleId` 持久化。
- 后端路由单测：覆盖 artifact 生成请求可携带 `primaryArticleId` 的传递路径。
- 前端构建：`npm --workspace neo-web run build` 覆盖 TypeScript 与 Vite bundle，包含自定义 Tiptap 节点与 slash 命令。
- 后端构建：`npm run build` 覆盖服务端 TypeScript。
- 文档链接：`npm run docs:check`。

## Deferred

- 不做跨文章推荐或复杂相关度排序。
- 不迁移历史 artifact；旧资源默认保持资源库级。
- 不把完整 `ArtifactViewer` 默认嵌进正文。
- 不删除或弱化 `ResourcesPanel` 的管理能力。
- 不恢复文章资源状态带或底部资源卡。
- 不实现段落级资源入口。