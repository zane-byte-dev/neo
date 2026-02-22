---
title: Project - Inkbrain Chrome Extension 架构设计
type: technical-spec
tags: [Dev, ChromeExtension, Architecture, AI, Plasmo]
date: 2026-01-28
status: in-progress
---

# 项目文档：Neo Chrome Extension (极简结构化剪藏器)

## 1. 产品定位 (USP)
**"手术刀级别的 AI 结构化剪藏"**。不同于通用的网页快照工具，Inkbrain 专注于对特定站点（Gemini, Twitter, GitHub）进行深度 DOM 解析，并结合边缘 AI 处理，直接产出成品笔记。

## 2. 交互设计：无界面 (Headless) 哲学
*   **弃用侧边栏**: 拒绝臃肿的 Chat 面板。
*   **DOM 寄生**: 将“保存”按钮直接注入目标网站的原生 UI 中（如 Gemini 的对话框旁，推文的操作栏内）。
*   **划词悬浮**: 仅在选中文字时浮现极简 ✨ 图标。
*   **静默反馈**: 采用 Toast 通知提示保存成功，不打断阅读流。

## 3. 三层管道架构 (Data Pipeline)

### Layer 1: 感知层 (DOM Parsers)
*   **职责**: 负责从 HTML 中提取“生肉”（Raw Data）。
*   **策略模式**:
    *   `gemini-parser.ts`: 区分 User/Model，提取 Markdown 对话。
    *   `twitter-parser.ts`: 提取作者、正文、高清图、时间戳。
    *   `selection-parser.ts`: 通用划词兜底。

### Layer 2: 认知层 (AI Processors)
*   **职责**: 加工数据。调用 Gemini API 进行总结、打标签、批判性提问。
*   **配置化**: 不同站点绑定不同 Prompt。
    *   *Twitter Prompt*: "分析传播逻辑与情绪。"
    *   *Gemini Prompt*: "提炼知识点与待办。"

### Layer 3: 存储层 (Dispatcher Adapters)
*   **职责**: 多端分发。
*   **适配器**:
    *   **Notion**: 调用 API 写入数据库。
    *   **Obsidian (黑科技)**: 利用 `obsidian://new` URI Scheme 实现**零网络、纯本地**的极速写入。

## 4. 核心技术栈
*   **框架**: Plasmo (React + Tailwind CSS).
*   **AI**: Vercel AI SDK (Gemini 1.5 Flash Provider).
*   **观察者**: `MutationObserver` 解决 SPA (单页应用) 的动态按钮注入。

---
*基于 2026-01-28 架构对齐对话整理*
