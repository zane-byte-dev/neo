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
- 创建批注时对选区应用现有 highlight 标记，并把选区位置写入 anchor。
- `NoteEditor` 正文上方新增轻量“文章批注”区：
  - 新建批注输入卡片。
  - 全部批注列表。
  - 点击 quote 后回到编辑器选区。
  - 状态切换和删除。

## Deferred

- 段落 hover `+ 批注` 入口。
- 选区高亮与 annotation id 的强绑定 mark。
- 批注回复线程、颜色、标签、批量导出与 AI 汇总。
- 文章编辑后 anchor 漂移修复。
