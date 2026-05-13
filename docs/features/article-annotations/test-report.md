# Article Annotations Test Report

## Scope

验证 Article Annotations MVP 的数据持久化、HTTP API、前端类型构建和文档链接。

## Automated Coverage

- `src/services/__tests__/notebook-service.test.ts`
  - 保存带 anchor 的 highlight annotation。
  - 列出当前文章 annotation。
  - 切换 `open` / `resolved` 状态。
  - 删除 annotation。
- `src/routes/__tests__/notebook-routes.test.ts`
  - 通过 HTTP 创建、列出、解决和删除 annotation。

## Manual / UI Coverage

- Web build 覆盖 `NoteEditor` 与 `NovelEditor` 的 TypeScript 类型。
- UI smoke：选中文章正文后，气泡菜单新增批注按钮；保存后正文以轻量下划线标记批注，hover 下划线会显示小弹窗。
- UI smoke：从批注弹窗或紧凑列表删除批注后，会同步移除正文下划线标记。
- Screenshot: <https://github.com/user-attachments/assets/a9c5ecad-fd02-4dc5-a055-f0e563e70d6c>

## Validation Commands

- ✅ `npm run build`
- ✅ `npm --prefix web run build`
- ✅ `npx vitest run src/services/__tests__/notebook-service.test.ts -t 'article annotations'`
- ✅ `npx vitest run src/routes/__tests__/notebook-routes.test.ts -t 'article annotation routes'`
- ⚠️ `npm test` currently has unrelated pre-existing failures in delete-route tests (`DELETE /api/notebook`, `DELETE /api/sessions/:id`).
- ⚠️ `npm run docs:check` currently has unrelated pre-existing broken links in `docs/product/DOC_REVIEW.md`.

## Known Gaps

- 全量 `npm test` 当前仍有 3 个既有删除路由相关失败，和本功能无关；本轮使用 targeted Vitest 覆盖新增 annotation 路径。
- 本轮尚未实现段落 hover 入口和 annotation id 级强绑定 mark；当前删除样式恢复依赖保存时记录的 anchor 区间，文章大幅改写后仍可能需要后续漂移修复。
