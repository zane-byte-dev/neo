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

Studio 产物类型：

| type | 说明 |
|------|------|
| `mindmap` | 生成思维导图结构 |
| `report` | 生成报告，可带 `subtype`、`title`、`customPrompt` |
| `audio` | 生成播客 / 朗读脚本 |

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
| `POST /api/notebook/artifact` | 生成 Studio 产物 |
| `POST /api/notebook/note/quick-action` | 对选中 notes 执行 AI 快捷操作 |

## 示例

仓库内的 [examples/workspace/notebooks/welcome.md](../../examples/workspace/notebooks/welcome.md) 展示了 frontmatter 与基本正文结构。