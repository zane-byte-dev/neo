# Changelog

All notable changes to Neo will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning while it is practical for the 0.x series.

## [Unreleased]

### Added

- **Local AI Gateway MVP**：新增 `/v1/models`、OpenAI-compatible `/v1/chat/completions` 和 Anthropic-compatible `/v1/messages`，支持 Settings / Models 中一键开启、生成 / 重置 per-user gateway Bearer token、文本非流式 / 流式调用、模型 alias / `auto` 路由、usage/cost 记录，以及 Anthropic `tool_use` / `tool_result` 协议透传。
- **Skill 搜索**：Settings / Skills 面板新增搜索框，可按技能名、描述、标签实时过滤，搜索无结果时显示空状态提示。
- **Claude Code 兼容代理接入**：Settings / Models 可保存 Claude Code 代理地址与 Token，并新增 `claude-code*` 模型别名直接用于对话。
- **AI 回复复制**：Web Chat 的 assistant 回复下方新增复制按钮，可一键复制当前回复正文，并排除工具调用日志。
- **对话搜索高亮**：Chat 侧边栏搜索时匹配词在标题中高亮显示（绿色 mark）。
- **欢迎页卡片自动发送**：首页快捷卡片点击后直接发送完整引导消息，不再只填充前缀文字。
- **工具调用卡片键盘可访问**：ActivityItemCard 在有详情内容时增加 `tabIndex` 和 Enter/Space 键盘支持，键盘和触屏用户均可展开详情。
- **批注 UI i18n**：NoteEditor 批注草稿区所有文案（新批注、占位符、保存、取消、解决/打开、删除等）改用 i18n key，支持多语言切换。
- **批注辅助面板**：文章编辑器“全部批注”入口升级为辅助面板，按文章顺序列出批注，支持全部 / 未解决 / 已解决 / 划线 / 段落筛选，并可点击跳回正文位置。

- **文章内资源 MVP**：文章编辑器新增低干扰生成入口，摘要保留为正文前轻量块，音频通过工具栏 icon 基于当前文章生成，思维导图和报告可通过 `/` 插入为折叠模块；新 artifact 会持久化 `sourceIds` / `primaryArticleId`，`ResourcesPanel` 继续作为 notebook 级资源库与管理入口。
- **文章批注 MVP**：文章编辑器选区气泡菜单新增批注入口，支持保存划线批注、在 `NoteEditor` 内查看全部批注、跳转原文选区、删除，以及 `open / resolved` 状态切换。后端新增独立 annotation 数据模型与 API。
- **Web 语音输入**：Chat 输入区右下角新增麦克风按钮，支持录音、停止/取消、转写并回填到输入框。录音最长 90 秒，默认不自动发送。后端新增 `POST /api/transcribe` 转写路由，优先使用 OpenAI Whisper，无 OpenAI key 时 fallback 到 Gemini 1.5 Flash。权限拒绝、浏览器不支持、无可用 provider 等情况均有内联错误提示与修复说明。
- **对话沉淀 Skill**：Agent 新增 `manage_skill` 内置工具，可把当前对话整理成可复用 Skill 并保存到用户 `stateDir/skills/`；保存后当前上下文会立即更新，后续可直接 `list_skills` / `run_skill` 复用，同一份 Skill 也会出现在 Settings / Skills。
- **Workflow Automation MVP**：新增声明式 Workflow 引擎，支持 `transform` / `agent` / `skill` 串行步骤、`manual` / `webhook` / `cron` 触发、运行历史与最近状态展示；Settings / Advanced / Automations 可保存 JSON 工作流并手动运行。
- Settings / Basic / Overview with a system status card for backend, account, model, and automation readiness.
- First-run checklist on the Chat welcome screen to guide model setup, first message, and Notebook note creation.
- User guides for Tools, Skills, Sandbox, MCP, Notebook, Automation, Browser Extension, Agent Runtime, and FAQ.
- Example user tool and Skill under `examples/tools/` and `examples/skills/`.
- PR checklist entries for README, docs, and changelog updates.

### Changed

- Workflow JSON 编辑器现在会在保存前校验工作流 ID、`trigger` / `steps` 结构与必填字段；语法错误会显示行列位置并把“检查 JSON”动作定位到出错位置，减少只能看到失败 toast 的排障成本。
- Dangerous-tool confirmations now de-duplicate replayed runtime events in Web Chat, so reconnect/replay no longer renders the same safety prompt twice; bash session/always approvals are now reused at the tool level instead of exact-command matching, which reduces repeated confirmations inside the same workflow. Chat stop/cancel is also now one-shot per active run, avoiding bursts of duplicate cancel requests from repeated clicks or Esc key repeats.
- Article resources no longer render a separate status strip or bottom resource-card area; notebook generation now resolves to an available provider before falling back to local models, generated mind maps/reports strip previously inserted resource blocks from prompts to avoid empty artifacts, article mind maps now render inline as embedded markmap blocks, article reports now render inline as structured Markdown content instead of raw text, and article toolbar audio now requests single-speaker narration instead of A/B dialogue.
- Article annotations now keep draft input and hover cards in a document-side right rail; underline hover reveals the matching card there, and deleting an annotation still removes its underline marker from the article body.
- Delete-route regression tests now align with the current trash/soft-delete behavior for articles and sessions.
- Skills REST routes now reuse a shared skill storage service, so Web Settings and chat-driven skill authoring share the same validation, enabled-state patching, and flat/nested file discovery.
- Cron task lists now surface real last-run status, duration, summary and errors; external webhook endpoints can pass through cookie auth and continue to use their configured secrets.
- Settings navigation now separates Basic (Overview, Models, Skills) from Advanced (Apps, MCP, Automations), and high-frequency settings errors include repair actions.
- Sidebar bulk chat deletion now uses the shared confirmation dialog instead of the browser-native confirm prompt.
- Chinese README now has one Quick Start path and an updated built-in tools table.
- English README now matches first-launch bootstrap behavior and current `stateDir` layout.

### Fixed

- 删除文章后，左侧文章目录会立即移除对应条目，并同步清理首页最近文章里的已删除入口。

## [0.1.0] - 2026-05-12

### Added

- Initial self-hosted personal AI assistant runtime.
- Web chat, Notebook, Telegram bot, multi-provider model routing, built-in tools, user tools, Skills, MCP loading, sandbox execution, resumable runs, and browser clipper.

[Unreleased]: https://github.com/zane-byte-dev/neo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zane-byte-dev/neo/releases/tag/v0.1.0
