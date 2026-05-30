# Article Annotations Dev Plan

## Scope

本轮实现最小可验证的正文批注闭环，优先落地“划线批注”作为第一条正文内路径：

- 在文章编辑器选中文本后，通过气泡菜单创建批注。
- 保存批注后持久化到 notebook 运行态目录，并保留 `quote + anchor`。
- 在 `NoteEditor` 内展示当前文章全部批注，支持跳转、删除、未解决 / 已解决状态切换。
- 保留现有独立 Notes，不做迁移或废弃。

## Data Model

新增 `NotebookAnnotation`：

- `id`
- `articleId`
- `notebook`
- `kind`: `highlight` | `paragraph`
- `quote`
- `anchor`: `startOffset / endOffset / beforeText / afterText / paragraphId`
- `body`
- `status`: `open` | `resolved`
- `author`
- `createdAt`
- `updatedAt`

存储位置：

```text
{stateDir}/notebooks/{notebook}/annotations/{articleSourceId}.json
```

## API

- `GET /api/notebook?action=annotations&notebook=...&articleId=...`
- `POST /api/notebook/annotation`
- `PATCH /api/notebook/annotation`
- `DELETE /api/notebook/annotation`

## Frontend

- `NovelEditor` 的选区气泡菜单新增“添加批注”按钮。
- 创建批注时对选区应用下划线标记，并把选区位置写入 anchor。
- `NoteEditor` 在文档右侧提供 sticky 批注 rail，承接新建批注与 hover 卡片：
  - 批注正文默认不展开。
  - hover 正文下划线时，在右侧 rail 展示对应批注卡片。
  - 卡片支持定位、状态切换和删除。
  - 删除批注后同步移除对应正文下划线。
- `NoteEditor` 右侧 rail 的“全部批注”入口升级为辅助面板：
  - 默认按 anchor 偏移量与创建时间排序，贴近文章顺序。
  - 支持全部 / 未解决 / 已解决 / 划线 / 段落筛选。
  - 每条批注可点击编号或引用跳转正文位置，并可切换状态或删除。

## Deferred

- 段落 hover `+ 批注` 创建入口。
- 选区高亮与 annotation id 的强绑定 mark。
- 批注回复线程、颜色、标签、批量导出与 AI 汇总。
- 文章编辑后 anchor 漂移修复。
