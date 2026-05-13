# Article Embedded Resources Test Report

## Scope

验证文章内资源 MVP 是否满足 Brief：文章内可发现资源状态、至少有轻量预览、可直接打开完整 viewer，并保留 `ResourcesPanel` 作为 notebook 级资源库。

## Acceptance Coverage

- ✅ 文章页标题区域新增“相关资源”状态带，展示摘要、音频、导图、报告状态。
- ✅ 正文底部新增“本篇资源”区，可展示音频、导图、报告轻量预览卡。
- ✅ 文章内资源卡可直接打开 `ArtifactViewer`，不需要先进入 `ResourcesPanel` 列表。
- ✅ `ResourcesPanel` 仍保留内容生成、已生成列表、笔记入口和资源管理能力。
- ✅ 新生成 artifact 会保存 `sourceIds` 与 `primaryArticleId`，文章页可区分本篇资源与资源库资源。

## Automated Coverage

- `src/services/__tests__/notebook-service.test.ts`
  - artifact primitive 覆盖 `sourceIds` / `primaryArticleId` 保存与读取。
- `src/routes/__tests__/notebook-source-studio.test.ts`
  - `POST /api/notebook/artifact` 覆盖 `primaryArticleId` 传入生成层。
- `npm --prefix web run build`
  - 覆盖 `NoteEditor`、`ArticleResources`、`StudioActionModal`、`ArtifactViewer` 的 TypeScript 与 Vite 构建。

## Validation Commands

- ✅ `npm run build -- --pretty false`
- ✅ `npx vitest run src/services/__tests__/notebook-service.test.ts src/routes/__tests__/notebook-source-studio.test.ts -t "artifact primitives|POST /api/notebook/artifact"`
- ✅ `npm --prefix web run build`
- ⚠️ `npm run docs:check` 当前被既有 `docs/product/DOC_REVIEW.md` 相对链接阻塞，共 13 个 broken links；本轮新增的 `article-embedded-resources` 链接未出现在失败列表中。

## Notes

- Web build 有既有 Rollup 注释警告与 chunk size warning，不影响构建通过。
- 历史 artifact 不会迁移；没有 `primaryArticleId` 且不是单一当前 source 的旧资源仍按资源库级处理。
- 本轮未实现跨文章推荐、段落级资源入口或完整 viewer 的正文内嵌模式。