---
type: tool
name: Inkbrain Clipper
language: python
version: 1.0.0
dependencies: [requests]
tags:
  - tool
  - skill
  - web
  - clipper
---

# ✂️ Tool: Inkbrain Clipper

> **一句话定位**: 命令行版 "Save to Obsidian"。一键抓取网页 -> Markdown -> 打开阅读。

## 🚀 如何使用 (Usage)

1.  **基础用法 (存入 00_收集)**:
    ```bash
    python3 "99_系统/Skills/clipper.py" "https://example.com/article"
    ```
2.  **指定目录**:
    ```bash
    python3 "99_系统/Skills/clipper.py" "https://example.com/article" "03_文章"
    ```

## ⚙️ 原理 (How it works)

1.  **Engine**: 使用 `r.jina.ai` 免费 API 将网页转为干净的 Markdown。
2.  **Storage**: 自动生成 YAML Frontmatter (Url, Date)，存入 Vault。
3.  **Action**: 复用 `obs_open` 协议，直接在 Obsidian 中打开新文件。

## 📦 依赖 (Installation)

需要安装 Python `requests` 库：
```bash
pip install requests
```
