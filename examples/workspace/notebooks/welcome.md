---
title: 欢迎使用 Neo
date: 2026-05-12
author: Neo Team
source: examples/workspace
summary: Neo Notebook 的最小示例，展示 frontmatter、正文和扩展归档方式。
tags: [neo, notebook, example]
---

# 欢迎使用 Neo

这是 Notebook 中的第一篇文档。Neo 会自动为 `notebooks/` 目录下的所有
Markdown 文件建立 SQLite + FTS5 索引——你可以直接在 Web UI 的
**Notebook** 面板搜索它们。

## 如何添加新条目

1. 在 Web UI Notebook 面板点击「新建」，或
2. 直接往这个目录扔 `.md` 文件，Neo 会增量索引
3. 修改后保存，索引会自动更新（无需手动 reload）

## frontmatter 字段

Notebook 会识别文件顶部的 YAML frontmatter。常用字段包括：

| 字段 | 说明 |
|------|------|
| `title` | 条目标题 |
| `date` | 日期，建议使用 `YYYY-MM-DD` |
| `author` | 作者或来源人 |
| `source` | 原始链接、文件名或来源说明 |
| `summary` | 列表页和搜索结果中使用的摘要 |
| `tags` | 标签数组，用于筛选和整理 |

## 浏览器扩展

安装 `extension/` 里的 Chrome 扩展后，可以一键把网页选中文本、
X.com 推文、Gemini 对话保存到 `Downloads/neo/inbox/`，再手动归档到这里。
