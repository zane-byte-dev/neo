# Article Embedded Resources Dev Plan

## Scope

本轮实现一个可发布的文章内资源 MVP，覆盖 Brief 的 Phase 1 与 Phase 2：

- 在文章标题与摘要附近增加“相关资源”状态带，展示摘要、音频、导图、报告的当前状态。
- 在正文底部增加“本篇资源”预览区，提供音频、导图、报告的轻量卡片。
- 点击文章内资源直接打开完整 `ArtifactViewer`，不需要先进入 `ResourcesPanel` 列表。
- 保留 `ResourcesPanel` 作为 notebook 级资源库与管理入口。
- 为新生成的 artifact 记录来源关联，使文章页能区分“本篇资源”和“资源库资源”。

## Current System

- `NoteEditor` 已经在正文区域内渲染摘要与文章批注，并通过顶部 `Layers` 按钮打开 `ResourcesPanel` overlay。
- `ResourcesPanel` 仍按资源库方式组织“内容生成 / 已生成 / 笔记”，适合管理 notebook 级资源。
- `StudioActionModal` 会把当前 `selectedSourceIds` 传给生成接口，但后端 `nbSaveArtifact` 尚未持久化 `sourceIds`。
- `ArtifactViewer` 已能承载 mindmap、report、audio 的完整消费，但文章页缺少轻量预览与直接打开路径。

## Data Model

扩展现有 artifact 元数据，不新增独立表：

- `sourceIds?: string[]`：本次生成使用的 source id 列表。
- `primaryArticleId?: string`：当 artifact 从文章内入口生成时，记录主关联文章的 `NoteEntry.id`。

判定规则：

- `primaryArticleId === note.id` 的 artifact 是强绑定“本篇资源”。
- 没有 `primaryArticleId` 但 `sourceIds` 仅包含当前文章 source id 的 artifact 也视为本篇资源，用于兼容单来源生成。
- 旧 artifact 或 notebook 级 artifact 继续留在资源库层，不默认塞入文章底部预览。

## Backend Changes

- `src/services/notebook-service.ts`
  - 扩展 `Artifact` / `ArtifactSaveInput`，保存 `sourceIds` 与 `primaryArticleId`。
  - 保持旧 artifact JSON 兼容，字段可选。
- `src/services/notebook-ai.ts`
  - `generateMindMap`、`generateReport`、`generateAudioScript` 写入生成时的 `sourceIds` 与可选 `primaryArticleId`。
  - 将 audio artifact 的脚本字段统一写为 `data.script`，viewer 仍兼容旧 `data.segments`。
- `src/routes/notebook-studio.ts`
  - `POST /api/notebook/artifact` 接收可选 `primaryArticleId` 并传给生成层。

## Frontend Changes

- `web/src/components/notebook/StudioActionModal.tsx`
  - 支持 `sourceIdsOverride` 与 `primaryArticleIdOverride`，供文章内入口强制基于当前文章生成。
  - 资源库入口仍沿用当前 `selectedSourceIds` 行为。
- `web/src/components/notebook/studio/ArtifactViewer.tsx`
  - audio viewer 同时支持 `data.script` 与旧 `data.segments`。
- `web/src/components/notebook/ArticleResources.tsx`
  - 新增文章内资源 UI 组件：状态带、底部预览区、预览提取 helper。
  - 只展示本篇强相关 artifact；资源库数量以独立入口提示。
- `web/src/components/NoteEditor.tsx`
  - 加载 notebook artifacts，并按当前文章过滤。
  - 在摘要附近渲染资源状态带。
  - 在正文底部渲染本篇资源预览区。
  - 支持从状态 chip / 预览卡直接打开 `ArtifactViewer` overlay。
  - 支持从文章内入口生成音频、导图、报告，并写入 `primaryArticleId`。

## Documentation Updates

- `docs/user-guide/NOTEBOOK.md`：补充文章内资源层与资源库层的区别。
- `docs/README.md`：功能文档索引加入 Article Embedded Resources。
- `docs/product/ROADMAP.md`：Web UI 增强增加文章内资源消费状态。
- `CHANGELOG.md`：Unreleased 增加本功能条目。
- `docs/features/article-embedded-resources/test-report.md`：记录验收覆盖、验证命令和风险。

## Testing Plan

- 后端单测：扩展 notebook artifact primitive，覆盖 `sourceIds` / `primaryArticleId` 持久化。
- 后端路由单测：覆盖 artifact 生成请求可携带 `primaryArticleId` 的传递路径。
- 前端构建：`npm --prefix web run build` 覆盖 TypeScript 与 Vite bundle。
- 后端构建：`npm run build` 覆盖服务端 TypeScript。
- 文档链接：`npm run docs:check`。

## Deferred

- 不做跨文章推荐或复杂相关度排序。
- 不迁移历史 artifact；旧资源默认保持资源库级。
- 不把完整 `ArtifactViewer` 默认嵌进正文。
- 不删除或弱化 `ResourcesPanel` 的管理能力。
- 不实现段落级资源入口。