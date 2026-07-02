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
- ✅ 文章正文中的思维导图折叠块会直接渲染为可交互导图，而不是原始 Markdown 文本。
- ✅ 报告 viewer 与插入模块兼容 `markdown` / `content` / `text` 等常见内容字段。
- ✅ 文章正文中的报告折叠块会直接按 Markdown 结构渲染标题、段落和列表，而不是原始 Markdown 文本。
- ✅ 在 Gemini 未配置的本地环境里，文章工具栏音频、slash 导图、slash 报告会自动改用可用 provider，不再默认落到空 artifact。
- ✅ 文章工具栏音频固定生成单人朗读脚本，不再误生成为 A/B 双人播客。
- ✅ 后续生成会忽略正文中旧的 `data-neo-generated-block` 折叠模块，避免把已生成资源再次喂回模型导致提示词污染。

## Automated Coverage

- `src/services/__tests__/notebook-service.test.ts`
  - artifact primitive 覆盖 `sourceIds` / `primaryArticleId` 保存与读取。
- `src/routes/__tests__/notebook-source-studio.test.ts`
  - `POST /api/notebook/artifact` 覆盖 `primaryArticleId` 传入生成层。
  - 覆盖音频 `customPrompt`、`audioMode` 从弹窗传入生成层。
- `src/services/__tests__/notebook-ai.test.ts`
  - 覆盖 JSON 树导图输出会规整为 Markdown。
  - 覆盖音频 artifact 保存 `script` / `segments` / `durationSeconds`。
  - 覆盖默认模型会优先选择已配置 provider 而不是盲目回退 `gemma`。
  - 覆盖 prompt 组装时会剥离已插入正文的生成资源块。
  - 覆盖文章工具栏音频入口会切到单人朗读 prompt。
- `npm --workspace neo-web run build`
  - 覆盖 `NoteEditor`、`NovelEditor` 自定义生成模块节点、slash command、`ArtifactViewer` 的 TypeScript 与 Vite 构建。

## Validation Commands

- ✅ `npm run build -- --pretty false`
- ✅ `npx vitest run src/services/__tests__/notebook-service.test.ts src/routes/__tests__/notebook-source-studio.test.ts -t "artifact primitives|POST /api/notebook/artifact"`
- ✅ `npx vitest run src/services/__tests__/notebook-ai.test.ts src/routes/__tests__/notebook-source-studio.test.ts`
- ✅ `npm --workspace neo-web run build`
- ⚠️ `npm run docs:check` 当前被既有 `docs/product/DOC_REVIEW.md` 相对链接阻塞，共 13 个 broken links；本轮新增的 `article-embedded-resources` 链接未出现在失败列表中。

## Browser Regression Validation

- ✅ 在 `http://localhost:5173/notebook/测试笔记本?article=notebooks/测试笔记本/你好啊_20260506.md` 复测文章工具栏音频：viewer 不再显示空脚本，最新 artifact 返回 2 段非空 `script/segments`，speaker 仅为 `A`，并带 `durationSeconds`。
- ✅ 在同一文章正文中用 `/` 重新生成报告：占位块会被替换为非空 Markdown 内容，标题保持 `报告：你好啊 · 报告`，不再出现重复前缀。
- ✅ 在同一文章正文中用 `/` 重新生成思维导图：占位块会被替换为非空 markmap Markdown，最新 artifact 的 `data.markdown` 不再为空。
- ✅ 文章内已有的思维导图块会在 `NovelEditor` 中直接渲染为 SVG 导图并保留缩放 / 适应窗口 / 重置控件。
- ✅ 文章内已有的报告块会在 `NovelEditor` 中直接渲染出标题、段落和列表层级，不再显示原始 `##` / `-` markdown 标记。
- ✅ 报告重生时只引用原始文章文本，不再把旧的空导图 / 空报告折叠块当作 prompt 上下文。

## Notes

- Web build 有既有 Rollup 注释警告与 chunk size warning，不影响构建通过。
- 历史 artifact 不会迁移；旧资源仍按资源库级处理，不自动回填到文章正文。
- 历史音频 artifact 若没有显式时长，会在前端按脚本文字数估算。
- 浏览器回归使用测试文章 `你好啊_20260506`，因此 notebook 中会保留一份新的单人朗读音频 artifact，以及新的报告 / 思维导图折叠块，作为本轮 smoke evidence。
- 本轮未实现跨文章推荐、段落级资源入口、历史 artifact 复用或完整 viewer 的正文内嵌模式。
