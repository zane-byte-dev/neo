# Article Embedded Resources Test Report

## Scope

验证文章内资源 MVP 是否满足更新后的 Brief：文章内不再增加资源状态栏或底部资源卡；音频使用工具栏 icon，导图 / 报告通过 `/` 插入可折叠模块，并保留 `ResourcesPanel` 作为 notebook 级资源库。

## Acceptance Coverage

- ✅ 文章页已移除“相关资源”状态带，摘要继续作为独立轻量块存在。
- ✅ 正文底部已移除“本篇资源”区，不再用资源卡压缩阅读区域。
- ✅ 文章工具栏新增音频 icon，可基于当前文章生成朗读音频并打开 `ArtifactViewer`。
- ✅ `/生成思维导图` 与 `/生成报告` 会插入可折叠模块，并在生成完成后替换模块内容。
- ✅ `ResourcesPanel` 仍保留内容生成、已生成列表、笔记入口和资源管理能力。
- ✅ 新生成 artifact 会保存 `sourceIds` 与 `primaryArticleId`，资源库仍能追踪文章来源。
- ✅ 音频 artifact 会保存脚本兼容字段与估算时长，完整播放器会显示时长。
- ✅ 思维导图插入模块与 viewer 兼容 Markdown 标题、列表和 JSON 树输出，避免生成后无内容。
- ✅ 报告 viewer 与插入模块兼容 `markdown` / `content` / `text` 等常见内容字段。

## Automated Coverage

- `src/services/__tests__/notebook-service.test.ts`
  - artifact primitive 覆盖 `sourceIds` / `primaryArticleId` 保存与读取。
- `src/routes/__tests__/notebook-source-studio.test.ts`
  - `POST /api/notebook/artifact` 覆盖 `primaryArticleId` 传入生成层。
  - 覆盖音频 `customPrompt` 从弹窗传入生成层。
- `src/services/__tests__/notebook-ai.test.ts`
  - 覆盖 JSON 树导图输出会规整为 Markdown。
  - 覆盖音频 artifact 保存 `script` / `segments` / `durationSeconds`。
- `npm --prefix web run build`
  - 覆盖 `NoteEditor`、`NovelEditor` 自定义生成模块节点、slash command、`ArtifactViewer` 的 TypeScript 与 Vite 构建。

## Validation Commands

- ✅ `npm run build -- --pretty false`
- ✅ `npx vitest run src/services/__tests__/notebook-service.test.ts src/routes/__tests__/notebook-source-studio.test.ts -t "artifact primitives|POST /api/notebook/artifact"`
- ✅ `npx vitest run src/services/__tests__/notebook-ai.test.ts src/routes/__tests__/notebook-source-studio.test.ts -t "generateMindMap|generateAudioScript|POST /api/notebook/artifact"`
- ✅ `npm --prefix web run build`
- ⚠️ `npm run docs:check` 当前被既有 `docs/product/DOC_REVIEW.md` 相对链接阻塞，共 13 个 broken links；本轮新增的 `article-embedded-resources` 链接未出现在失败列表中。

## Notes

- Web build 有既有 Rollup 注释警告与 chunk size warning，不影响构建通过。
- 历史 artifact 不会迁移；旧资源仍按资源库级处理，不自动回填到文章正文。
- 历史音频 artifact 若没有显式时长，会在前端按脚本文字数估算。
- 本轮未实现跨文章推荐、段落级资源入口、历史 artifact 复用或完整 viewer 的正文内嵌模式。
