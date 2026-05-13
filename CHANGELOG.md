# Changelog

All notable changes to Neo will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning while it is practical for the 0.x series.

## [Unreleased]

### Added

- **文章内资源 MVP**：文章编辑器新增低干扰生成入口，摘要保留为正文前轻量块，音频通过工具栏 icon 基于当前文章生成，思维导图和报告可通过 `/` 插入为折叠模块；新 artifact 会持久化 `sourceIds` / `primaryArticleId`，`ResourcesPanel` 继续作为 notebook 级资源库与管理入口。
- **文章批注 MVP**：文章编辑器选区气泡菜单新增批注入口，支持保存划线批注、在 `NoteEditor` 内查看全部批注、跳转原文选区、删除，以及 `open / resolved` 状态切换。后端新增独立 annotation 数据模型与 API。
- **Web 语音输入**：Chat 输入区右下角新增麦克风按钮，支持录音、停止/取消、转写并回填到输入框。录音最长 90 秒，默认不自动发送。后端新增 `POST /api/transcribe` 转写路由，优先使用 OpenAI Whisper，无 OpenAI key 时 fallback 到 Gemini 1.5 Flash。权限拒绝、浏览器不支持、无可用 provider 等情况均有内联错误提示与修复说明。
- Settings / Basic / Overview with a system status card for backend, account, model, and automation readiness.
- First-run checklist on the Chat welcome screen to guide model setup, first message, and Notebook note creation.
- User guides for Tools, Skills, Sandbox, MCP, Notebook, Automation, Browser Extension, Agent Runtime, and FAQ.
- Example user tool and Skill under `examples/tools/` and `examples/skills/`.
- PR checklist entries for README, docs, and changelog updates.

### Changed

- Article resources no longer render a separate status strip or bottom resource-card area; generated mind maps normalize before insertion/display, audio generation uses the article toolbar icon, and audio format/custom prompt settings pass through to backend generation.
- Article annotations now use underline markers with hover popovers; deleting an annotation also removes its underline marker from the article body.
- Settings navigation now separates Basic (Overview, Models, Skills) from Advanced (Apps, MCP, Automations), and high-frequency settings errors include repair actions.
- Sidebar bulk chat deletion now uses the shared confirmation dialog instead of the browser-native confirm prompt.
- Chinese README now has one Quick Start path and an updated built-in tools table.
- English README now matches first-launch bootstrap behavior and current `stateDir` layout.

## [0.1.0] - 2026-05-12

### Added

- Initial self-hosted personal AI assistant runtime.
- Web chat, Notebook, Telegram bot, multi-provider model routing, built-in tools, user tools, Skills, MCP loading, sandbox execution, resumable runs, and browser clipper.

[Unreleased]: https://github.com/zane-byte-dev/neo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zane-byte-dev/neo/releases/tag/v0.1.0
