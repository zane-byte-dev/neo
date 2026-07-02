# Article Annotations Test Report

## Scope

验证 Article Annotations MVP 的数据持久化、HTTP API、前端类型构建，以及批注 hover 卡片迁移到文档右侧 rail 后的交互与文档同步。

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
- UI smoke：选中文章正文后，气泡菜单新增批注按钮；保存后正文以轻量下划线标记批注，草稿输入出现在文档右侧 rail。
- UI smoke：hover 正文下划线时，文档右侧显示对应批注卡片，可定位、切换状态或删除。
- UI smoke：从右侧批注卡片或“全部批注”列表删除批注后，会同步移除正文下划线标记。
- UI smoke：展开右侧“全部批注”后，辅助面板按文章顺序列出批注，支持全部 / 未解决 / 已解决 / 划线 / 段落筛选，并可点击编号或引用跳转正文。
- Screenshot: <https://github.com/user-attachments/assets/a9c5ecad-fd02-4dc5-a055-f0e563e70d6c>

## Validation Commands

- ✅ `npm run build`
- ✅ `npm --workspace neo-web run build`
- ✅ `npx vitest run src/routes/__tests__/notebook-routes.test.ts src/routes/__tests__/notebook.test.ts src/routes/__tests__/session.test.ts`
- ✅ `npx vitest run src/services/__tests__/notebook-service.test.ts -t 'article annotations'`
- ✅ `npx vitest run src/routes/__tests__/notebook-routes.test.ts -t 'article annotation routes'`
- ✅ `npm test`
- ✅ `npm run docs:check`

## Known Gaps

- 本轮尚未实现段落 hover 创建入口和 annotation id 级强绑定 mark；当前删除样式恢复依赖保存时记录的 anchor 区间，文章大幅改写后仍可能需要后续漂移修复。
