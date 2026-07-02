# Changelog

All notable changes to Neo will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning while it is practical for the 0.x series.

## [Unreleased]

### Added

- **终端交互式 REPL（`npm run repl`）**：新增类似 Claude Code 的常驻终端对话入口 [packages/app/src/repl.ts](packages/app/src/repl.ts)（核心逻辑 [packages/app/src/cli/repl.ts](packages/app/src/cli/repl.ts)，依赖注入、可单测）。复用 `@neo/runtime` 直接进程内跑 Agent，无需 HTTP：多轮持续会话、流式输出、工具调用展示、危险工具的交互式 y/N 确认；支持 `/help`、`/new`、`/model [id]`、`/session`、`/clear`、`/exit` 斜杠命令，Ctrl+C 取消当前回合（空闲时退出）、Ctrl+D 退出。可用 `--user` / `--model` 指定用户与模型。为保持终端可读，REPL 默认把应用日志静音（等价 `LOG_LEVEL=critical`），只渲染对话；用 `LOG_LEVEL=debug`（或 `DEBUG_LLM=1`）可恢复完整日志。现有的一次性 `npm run cli -- <message>` 保持不变。

### Fixed

- **LLM 流式错误不再向终端/日志倾泻原始堆栈**：为 `streamText` 显式提供 `onError`，取代 AI SDK 默认的 `console.error(error)`（会打印整段 stack trace 与请求体）。真正的错误信息仍通过 `fullStream` 的 `error` part 走 `log.error` 并回传给用户，堆栈仅在 `LOG_LEVEL=debug` 时记录。详见 [packages/agent/src/llm/client.ts](packages/agent/src/llm/client.ts)。

- **Connector Center 后端 MVP**：把 MCP server 管理升级为「连接器」模型。`Settings / Advanced / MCP Servers` 新增：基于模板创建连接器（`filesystem` / `github` / `custom-stdio`，敏感字段以 password 输入）、保存前 / 已保存 server 的**连通性测试**（展示结构化状态码与工具数量）、以及连接成功后按工具的启用 / 禁用开关。新增内置连接器模板与结构化连通性测试，把启动失败归一成可定位的状态码（`missing_secret` / `cwd_not_found` / `command_not_found` / `process_exited` / `timeout` / `invalid_rpc` / `no_tools` 等），并改进 `stdio-client` 让 spawn 失败（ENOENT）立即冒泡而非超时；工具开关在 `loader` 中**服务端强制生效**（`mcp.json` 顶层新增 `disabledTools` 字段，被禁用工具不会注册给 Agent）。新增路由 `GET /api/mcp/templates`、`POST /api/mcp/test`、`POST /api/mcp/:name/test`、`PATCH /api/mcp/:name/tools/:tool`。详见 [user-guide/MCP.md](docs/user-guide/MCP.md)。
- **工具上下文懒加载 MVP**：默认对话不再把每个工具的完整说明注入模型，而是只给一句话用途摘要（参数 schema 保持完整，工具仍可直接调用）；新增 `search_tools` 工具，模型可按 `name` / `query` / `category` 按需展开某个工具的完整说明与参数 schema。新增统一工具元数据来源 `src/tools/tool-catalog.ts` 与精简目录渲染（`builtin-guide.ts` 的 `compact` 模式），并新增用户偏好 `toolContext: 'lazy' | 'full'`（默认 `lazy`，可切回 `full` 复现旧行为）。`search_tools` 在 plan / notebook 只读模式下不会暴露写 / 危险工具。详见 [user-guide/TOOLS.md](docs/user-guide/TOOLS.md)。
- **工具错误分类 MVP**：新增集中式错误分类器 `src/llm/tool-error-classifier.ts`，工具失败时给出结构化标签（`transient` / `quota` / `permanent` / `validation` / `unknown` + `retryable` + 建议动作），并在 `buildAiTools()` 的执行收敛点把提示追加到 tool result 末尾回灌给模型，由模型自行决定是否重试（框架不做自动 backoff）。基于通用启发式（HTTP 状态码、权限 / 参数 / 网络 / 限流关键词，中英文），工具可通过 `meta.classifyError` 声明按工具覆盖；与现有 `tool-loop-guard` 协同，短路兜底行为不变。详见 [user-guide/TOOLS.md](docs/user-guide/TOOLS.md)。
- **Agent Profiles MVP**：新增声明式 `AgentProfile`，可按入口（web-chat / telegram / cron / webhook / workflow 等）或显式请求选择不同的能力与行为边界——工具 allow/deny 与权限层级上限、模型覆盖、人格注入、记忆策略（`off` / `read` / `read-write`）。内置 `default`（不做任何约束，保持现状）、`research`（只读）、`coding`（禁危险 shell）三个 profile，可通过 `LocalConfig.PROFILES` / `LocalConfig.ENTRYPOINT_PROFILES`（或同名环境变量）覆盖与绑定。详见 [user-guide/AGENT_PROFILES.md](docs/user-guide/AGENT_PROFILES.md)。
- **Local AI Gateway MVP**：新增 `/v1/models`、OpenAI-compatible `/v1/chat/completions` 和 Anthropic-compatible `/v1/messages`，支持 Settings / Models 中一键开启、生成 / 重置 per-user gateway Bearer token、文本非流式 / 流式调用、模型 alias / `auto` 路由、usage/cost 记录，以及 Anthropic `tool_use` / `tool_result` 协议透传。
- **Local AI Gateway model discovery**：`/v1/models` 现在同时返回 Neo alias 和对应 provider model id，减少外部客户端把短 alias 过滤成“无可用模型”的情况。
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
