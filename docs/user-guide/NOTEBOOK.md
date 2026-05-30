# Notebook 使用指南

Notebook 是 Neo 的个人知识库。原始 Markdown 文件存放在 `{workDir}/notebooks/`，索引和 AI 产物存放在 `{stateDir}/notebooks/` 等运行态目录中。

## 目录结构

```text
{workDir}/notebooks/
└── personal/
    └── welcome.md
```

每个一级子目录就是一个 notebook。Markdown 支持可选 frontmatter：

```markdown
---
title: 示例笔记
date: 2026-05-12
author: Alice
source: https://example.com/article
summary: 一句话摘要
tags: [neo, notebook]
---

正文内容。
```

## 添加内容

| 方式 | 说明 |
|------|------|
| Web UI 新建 | 在 Notebook 面板创建或编辑条目 |
| 直接放 Markdown | 把 `.md` 文件放入 `{workDir}/notebooks/<name>/` |
| URL 导入 | 通过 Notebook 导入 URL；YouTube URL 会走专门解析逻辑 |
| 文本导入 | 粘贴原文，Neo 生成 source 条目 |
| 文件导入 | 先走 `/api/upload` 解析 PDF / Word / Excel / 图片等，再导入 Notebook |

导入 source 后，Neo 会后台生成 source guide。失败只会记录 warning，不影响原文保存。

## Sources、Notes、Studio

- **Sources**：原始来源，适合保存文章、网页、PDF 解析文本、YouTube 文本等。
- **Notes**：你或 AI 生成的整理笔记，支持保存、删除、转换为 source。
- **Studio**：围绕一个 notebook 或一组选中的 sources 生成 overview、mindmap、report、audio script 等产物。
- **文章内资源**：打开单篇文章时，摘要显示为正文前的轻量块；音频通过工具栏 icon 生成单人朗读；导图和报告可通过 `/` 插入为折叠模块。

Studio 产物类型：

| type | 说明 |
|------|------|
| `mindmap` | 生成思维导图结构 |
| `report` | 生成报告，可带 `subtype`、`title`、`customPrompt` |
| `audio` | 生成播客 / 朗读脚本 |

## 文章内资源

文章页内的资源入口用于低干扰地生成当前文章相关 AI 产物，资源面板仍用于浏览和管理 notebook 全量资源。

- 摘要仍显示在正文前方；隐藏后会保留一个轻量“摘要”入口用于恢复。
- 右上角音频 icon 会基于当前文章生成单人朗读脚本，并打开完整 audio viewer。
- 在正文中输入 `/` 可选择“生成思维导图”或“生成报告”；生成中会先插入占位模块，完成后替换为可折叠内容块。思维导图会直接在正文块内渲染为可交互导图，报告会直接按 Markdown 结构渲染为正文内容，而不是原始文本。
- 从文章内生成资源时，Neo 会把当前文章记录为 `primaryArticleId`，并把当前文章 source id 写入 artifact 的 `sourceIds`。
- 旧 artifact 或 notebook 级 artifact 不会默认铺进正文，可继续从资源面板查看、删除或重新生成。

## 文章批注

打开已保存文章后，可以直接在 `NoteEditor` 正文内选中文本，并点击气泡菜单中的“批注”按钮。Neo 会：

1. 给选区应用下划线标记。
2. 在文档右侧打开轻量批注输入卡片。
3. 保存 `quote + anchor + body` 到 `{stateDir}/notebooks/<notebook>/annotations/`。

保存后，批注正文默认不展开；将鼠标悬停在正文下划线处会在文档右侧显示对应批注卡片，可查看内容、定位、切换“未解决 / 已解决”或删除。右侧的“全部批注”入口可以展开辅助面板，按文章顺序浏览批注，并按全部 / 未解决 / 已解决 / 划线 / 段落筛选；点击编号或引用会跳回正文位置。删除批注会同步移除正文下划线。独立 Notes 入口仍保留，用于整篇文章级整理。

## 引用模式

Notebook 配置中有 `citationMode`：

| 模式 | 说明 |
|------|------|
| `strict` | 回答尽量限定在检索到的来源内，更适合资料问答 |
| `mixed` | 允许结合模型常识和来源内容，更适合发散分析 |

Chat 中使用 Notebook 时，Neo 会把 citation 信息贯通到前端；点击引用可以跳转回对应来源片段。

## 搜索

Notebook 使用 SQLite FTS5 建立统一索引。英文、代码标识符等 token 命中更稳定；中文查询会结合整句 LIKE fallback。搜索入口包括 Notebook 面板、`notebook_search` 工具和对话中的知识检索。

## API 速查

| API | 说明 |
|-----|------|
| `GET /api/notebook?action=notebooks` | 列出 notebook |
| `GET /api/notebook?action=list&notebook=personal` | 列出条目 |
| `GET /api/notebook?action=search&q=...` | 搜索条目 |
| `POST /api/notebook/import` | 导入 URL / 文本 / 已解析文件 |
| `GET /api/notebook/source?action=list-with-guides` | 列出 sources 与 guides |
| `GET /api/notebook?action=annotations&notebook=...&articleId=...` | 列出文章批注 |
| `POST /api/notebook/annotation` | 创建文章批注 |
| `POST /api/notebook/artifact` | 生成 Studio 产物 |
| `POST /api/notebook/note/quick-action` | 对选中 notes 执行 AI 快捷操作 |

## 示例

仓库内的 [examples/workspace/notebooks/welcome.md](../../examples/workspace/notebooks/welcome.md) 展示了 frontmatter 与基本正文结构。
