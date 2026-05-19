# Neo Roadmap

> 功能规划与开发路线图。按优先级分为 P0（核心）、P1（重要）、P2（锦上添花）三档。
>
> **最后更新：2026-05-16**（第二轮 PM 审计后同步，详见 [PM_AUDIT_REPORT_2026-05-16.md](PM_AUDIT_REPORT_2026-05-16.md)）

---

## P0 — 核心能力补全

### 1. 多模态（Multimodal）

当前状态：已支持图片理解、文档解析、文件上传，图片/视频生成。

- [x] **图片理解**：将 Telegram / Web 上传的图片以 base64 或 inline_data 传入 Gemini Vision，实现 OCR、图表分析、截图问答
<!-- - [ ] **语音转文字**：接入 Gemini 音频能力或 Whisper，将语音消息转写后再交给 LLM -->
- [x] **PDF / 文档解析**：上传 PDF、Word、Excel 时自动提取文本，作为上下文送入对话
- [x] **Web UI 文件上传**：前端支持拖拽/粘贴上传图片和文件，Chat 中直接引用
- [x] **图片生成增强**：支持在 Web UI 中渲染生成的图片，支持下载/预览
- [x] **视频生成**：通过 Google Veo 3.1 生成短视频（4-8 秒含音效），在 Web UI 中直接播放

### 2. 沙箱执行（Sandbox）

当前状态：内置 `src/sandbox/` 抽象层；`bash` 工具默认在宿主机运行（保持向后兼容），可通过 `SANDBOX_MODE=docker` 切换到 Docker 沙箱；新增 `code_exec` 工具提供持久化 Python / Node.js REPL。

- [x] **Docker 沙箱**：设置 `SANDBOX_MODE=docker` 后，每次 `bash` 调用在 `docker run --rm` 容器内执行，mount workDir→`/work`，drop-all-caps + `no-new-privileges` + `--network=none`（默认），自动回退到宿主模式当 docker 不可用
- [x] **REPL 模式**：`code_exec` 工具支持 Python / Node 持久化会话（按 userId+sessionId+language 隔离），变量/导入/函数定义跨调用保留；driver 进程常驻，通过 JSON 行协议喂代码
- [x] **代码输出可视化**：沙箱执行后自动扫描 `.outputs/`（可通过 `SANDBOX_OUTPUT_DIR` 配置）下的新增文件；图片类 artifact 直接通过 `imageCallback` 推送到 Web UI，其他类型以 artifact 列表附在结果中
- [x] **沙箱文件系统**：Docker 模式下 workDir 挂载为 `/work`，支持 `SANDBOX_READONLY=1` 切换为只读；容器内 `/tmp` 为写入区
- [x] **超时 & 资源限制**：`SANDBOX_MEMORY_MB`（默认 512）、`SANDBOX_CPUS`（默认 1）、`SANDBOX_PIDS`（默认 256）、`SANDBOX_TIMEOUT_MS`（默认 30000，硬上限 `SANDBOX_MAX_TIMEOUT_MS` 默认 300000）

### 3. 完善工具体系（Tool System）

当前状态：内置 20+ 工具 + 用户自定义工具，已支持 MCP、权限分级、结果缓存和工具循环防护。

- [x] **MCP 协议支持**：实现 Model Context Protocol 客户端（stdio transport），通过 `{workDir}/mcp.json` 配置 MCP Server，自动加载远程工具（前缀 `mcp__<server>__<tool>`）
- [x] **工具权限分级**：工具分为 read / write / dangerous 三级（`ToolMeta.permission`），plan mode 下仅允许 read 级别；未标注工具通过启发式推断
- [x] **工具执行确认**：dangerous 级别工具在 `ToolContext.confirmCallback` 存在时会先征求确认，拒绝则返回 `[DENIED]`；Web UI 已接入（Chat 设置里的盾牌图标开启后，在会话中实时弹出 Approve/Deny 按钮）；支持 once / session / always 三种放行 scope，可在 /models 页面撤销
- [x] **工具结果优化**：tool_result 改为智能截断（头 500 + 尾 200 + 省略标记），完整原文写入内存 LRU 缓存，通过 `GET /api/tool-result/:id` 按需拉取
- [x] **工具重试与容错**：新增 `withRetry` 指数退避工具；已应用于 fetch_url、search_web（仅对 5xx/429/网络错误重试）
- [x] **工具使用统计**：记录每个工具的调用频率、成功率、平均耗时，供优化参考（`GET /api/tool-stats`）
- [x] **扩展内置工具**：新增 `subagent`（委托子 Agent 完成复杂子任务）、`research`（自动多步调研汇总）、`todo`（任务清单管理）、`ask_user`（会话中征询用户输入）
- [x] **对话沉淀为 Skill**：新增 `manage_skill` 内置工具，Agent 可把当前对话整理为用户 Skill 并写入 `{stateDir}/skills/`；保存后当前上下文立即可 `list_skills` / `run_skill` 复用，Settings / Skills 继续复用同一份存储。
- [x] **工具循环防护**：按 toolName 跟踪连续失败签名，同一工具连续失败 3 次后自动短路并提示换源；finishReason 为 tool-calls 且无有效文本时触发 synthesis 兜底回答

---

## P1 — 重要增强

### 4. RAG & 语义记忆

当前状态：已支持基于 SQLite + FTS5 的统一知识索引，覆盖 notebook source / note 与 episodic / semantic memory；Notebook citation 已精确到 `chunkId + charStart + charEnd`，但 embedding 与真正的向量语义检索尚未落地。

- [x] **统一知识索引底座**：为 notebook source / note、episodic memory、semantic memory 建立统一 document + chunk + FTS 索引，支持全量重建
- [x] **Notebook 精确引用**：Notebook chat 命中统一索引后返回 `chunkId + charStart + charEnd`，前端可按偏移跳转来源片段

- [ ] **Embedding 向量化**：对 Notebook 条目和记忆文件生成向量嵌入，写入本地向量数据库（如 SQLite + vss 扩展或 FAISS）
- [ ] **语义检索**：对话时自动检索相关知识片段注入上下文（Retrieval-Augmented Generation）
- [ ] **自动记忆提取**：对话结束后自动从对话中提取关键事实、偏好、决策，写入长期记忆
- [ ] **记忆衰减 & 整合**：定期合并/压缩旧记忆，保持记忆库精简有效
- [ ] **对话摘要**：长会话自动生成摘要，替代原始历史消息以节省上下文窗口

### 5. 多模型支持

当前状态：已支持 Google Gemini（API Key + CLI OAuth）、DeepSeek、OpenAI GPT、Anthropic Claude、Ollama 本地模型，内置智能路由 + 自动 fallback + 用户偏好。

- [x] **DeepSeek 接入**：通过 AI SDK 接入 DeepSeek API（deepseek-chat / deepseek-reasoner）
- [x] **本地模型**：支持 Ollama / 本地 Gemma，适配隐私敏感场景
- [x] **模型路由策略**：根据任务特性自动选择模型（有工具 → DeepSeek，纯对话 → Gemini ACP / flash）
- [x] **Gemini ACP**：通过 Gemini CLI OAuth 接入，利用 Google One AI Premium 配额
- [x] **OpenAI / Claude 接入**：通过 AI SDK 的 `@ai-sdk/openai` / `@ai-sdk/anthropic` 接入；设置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 即启用，内置别名 `gpt-4o` / `gpt-4o-mini` / `gpt-5` / `claude-sonnet` / `claude-opus` / `claude-haiku`，价格表已纳入预算统计
- [x] **模型 fallback**：`chatWithContextStreaming` 按 `fallbackChain` 顺序尝试，`switch-model`（429/503/超时）自动切换下一款，`retry-same`（5xx）原模型指数退避，`fatal`（4xx）立刻抛出；`usage.jsonl` 记录 `fallbackUsed` + `originalModel`
- [x] **用户可配置**：每个用户可通过 `space/{userId}/preferences.json` 或 `GET/POST /api/preferences` 设置 `defaultModel` 与 `enabledModels`；未显式选择模型时自动套用 `defaultModel`

### 6. Web UI 增强

当前状态：React 前端有 Chat 和 Notebook 面板，功能完善；欢迎页已提供首次使用清单；支持 Mini-app 托管；零配置首启自动生成默认配置。文章批注与文章内资源 MVP 已落地，语音输入已上线。

- [x] **Artifact 渲染**：代码块支持语法高亮 + 一键复制；支持折叠超长代码块；支持 Mermaid 图表、数学公式（KaTeX）渲染
- [x] **思维过程展示**：展示 AI 的思考过程（thinking/reasoning chunks）和工具调用过程，可折叠
- [x] **会话管理增强**：会话搜索、批量删除、导出为 Markdown
- [x] **移动端适配**：响应式布局，适配手机和平板（侧边栏抽屉、安全区域、长按菜单）
- [x] **深色/浅色主题**：三主题（Light / Dark / Classic Dark）手动切换
- [x] **键盘快捷键**：Cmd+N 新建会话、Cmd+B 切换侧边栏
- [x] **首次使用清单**：Chat 欢迎页新增"开始使用 Neo" checklist，引导完成模型配置、第一条消息和 Notebook 笔记创建，并支持完成状态自动刷新与关闭持久化
- [x] **设置清晰度与系统状态**：设置页新增 Basic / Advanced 分层、Overview 系统状态卡片，以及模型、Telegram、MCP、自动化失败时的修复入口
- [x] **语音输入**：Web 端支持录音并转文字；前端使用 MediaRecorder 采集音频 Blob，后端新增 POST /api/transcribe 统一转写接口（OpenAI Whisper 优先，Gemini 1.5 Flash fallback），转写结果回填到输入框，默认不自动发送；权限拒绝、浏览器不支持、无可用 provider 等场景均有错误提示
- [x] **Mini-app 托管**：每个用户可在 `{stateDir}/apps/` 下放置静态 Web 应用，侧边栏「应用」分组动态列出，支持 `manifest.json`（title/description/icon）；路由隔离，每个用户只能访问自己的应用
- [x] **零配置首启**：首次启动时若无 `config.local.ts` 与 `USERS` 环境变量，自动在 `~/.neo/config.json` 生成默认单用户配置（随机 token/SESSION_SECRET、标准目录），并将登录 token 打印到控制台
- [x] **模型路由可视化配置**：/models 展示 provider 在线状态（Ollama 探活、ACP 检查 CLI 路径、云端检查 key），支持在 UI 中覆盖路由层级（simple/standard/complex 各 tier），配置持久化到 `{stateDir}/routing.json`
- [x] **文章批注 MVP**：文章编辑器支持选区批注，批注以独立 annotation 数据模型持久化；正文用下划线标记，hover 弹窗可查看、跳转、删除，并切换未解决 / 已解决状态
- [x] **文章内资源 MVP**：文章编辑器采用低干扰资源入口；摘要保留为正文前轻量块，音频通过工具栏 icon 基于当前文章生成，思维导图与报告通过 `/` 插入为可折叠模块；新生成 artifact 会记录 `sourceIds` / `primaryArticleId`，资源面板继续承担 notebook 级浏览与管理
- [ ] **批注辅助面板**：按文章顺序列出所有批注，支持 open/resolved 筛选和点击跳转正文位置（P1，当前最大缺口）
- [ ] **段落批注入口**：鼠标 hover 段落左侧出现"+ 批注"按钮，不要求精准选区（P1）
- [ ] **Slash 命令面板**：输入 `/` 后弹出可用生成命令列表，用户无需记忆确切词（P1）
- [ ] **语音输入语言偏好**：允许用户指定转写语言，降低中英混合场景误识率（P2）
- [ ] **语音输入自动发送偏好**：用户可配置转写后是否自动发送（P2 Phase 2 规划项）
- [ ] **音频 artifact 复用**：工具栏音频 icon 先检查历史同文章朗读，存在时直接打开 viewer（P2）
- [ ] **操作按钮触屏友好**：工具调用卡片"详情"按钮、侧边栏对话项操作按钮改为常驻或长按唤起，修复移动端不可用问题（P2）

### 7. 工作流与自动化

当前状态：cron-agent 定时任务 + Webhook 入口已落地；Agent 运行时已升级为持久化、可恢复模型，支持进程重启后恢复执行；Workflow MVP 已支持声明式串行步骤、手动 / Webhook / Cron 触发与运行历史。

- [x] **可恢复 Agent 运行时**：每次 Agent 执行创建持久化 run（文件事件日志），进程重启或 SSE 断线后可从 `cursor` 继续追补事件；工具确认状态持久化，approved 后自动恢复执行；cron、Telegram、Webhook 等后台入口统一复用同一 run model
- [x] **Webhook 入口**：`POST /api/webhook` 接收外部事件，触发 Agent 任务执行，结果通过 Telegram / webhook response 回传；run 完成后消费 `run_completed` 与 `artifact_created` 事件
- [x] **工作流引擎 MVP**：定义 JSON 多步骤工作流，支持 `transform` / `agent` / `skill` 串行步骤、前序输出引用、手动 / Webhook / Cron 触发与运行历史
- [ ] **Workflow 步骤模板与向导**：提供常用 Workflow 模板和分步创建向导，降低 JSON 编辑门槛（P1，PM 审计 U12/O11 关键问题）
- [ ] **工作流步骤类型增强**：新增条件分支（branch）、失败重试（retry）、并行步骤（parallel）（P1 Phase 2）
- [ ] **事件触发器**：文件变更、新邮件等外部事件自动触发工作流（当前 Webhook 已覆盖 HTTP 入口）
- [x] **Skill 编排 MVP**：工作流步骤可调用已有 Skill，后续步骤可通过 `{{previous}}` 或 `{{steps.stepId}}` 读取输出
- [x] **定时任务增强 MVP**：Cron 列表显示最近运行状态、耗时、摘要和错误，并提供运行历史 API
- [ ] **外部服务集成**：日历（Google Calendar）、邮件（IMAP/SMTP）、RSS 订阅触发

---

## P2 — 锦上添花

### 8. 多平台接入

当前状态：仅支持 Telegram Bot 和 Web UI。

- [ ] **微信机器人**：接入企业微信或个人微信（基于 wechaty 等框架）
- [ ] **Discord Bot**：接入 Discord，支持频道/DM 对话
- [ ] **飞书机器人**：接入飞书/Lark Bot（已有飞书 SDK 依赖）
- [ ] **API / SDK**：提供 RESTful API + TypeScript/Python SDK，方便第三方集成
- [ ] **统一消息抽象**：抽象出平台无关的消息协议层，新增平台只需实现 adapter

### 9. 安全与多用户

当前状态：基于 config.json 的简单用户管理，Cookie Session 认证，基础的命令黑名单；凭据（API Key）已支持 UI 管理并加密存储。

- [x] **凭据 UI 管理**：`POST /api/secrets` 管理 Gemini / DeepSeek / OpenAI / Anthropic API Key 及 Telegram token（AES-256-GCM 加密，密钥从 SESSION_SECRET 派生，存储于 `{stateDir}/secrets.json.enc`）；Telegram token 变更时自动 stop → 重新 sync bot；UI CredentialsCard 展示各 provider 配置状态
- [ ] **OAuth 登录**：支持 GitHub / Google OAuth，简化注册和登录
- [ ] **API Key 认证**：为 API 调用提供独立的 API Key 机制
- [ ] **速率限制**：按用户/IP 限制 API 调用频率，防止滥用
- [ ] **操作审计日志**：完整记录所有工具调用、文件操作、模型请求，支持查询和导出
- [ ] **工作区隔离加固**：确保用户工具/命令执行严格限制在自己的 workspace 中

### 10. 可观测性与运维

当前状态：控制台日志 + JSONL 文件日志，PM2 进程管理；token 用量已按月追踪并可通过 API 查询。

- [x] **Token 用量追踪**：`token-tracker.ts` 按月写入 `logs/token-usage-YYYY-MM.jsonl`，记录 model / inputTokens / outputTokens / cost / fallbackUsed；`GET /api/models?month=YYYY-MM` 可查询月度汇总，Web UI 展示每日用量图表
- [ ] **结构化 Metrics**：记录 LLM 调用延迟、工具执行耗时等关键指标
- [ ] **健康检查端点**：`/health` 端点返回服务状态、依赖连通性
- [ ] **错误追踪集成**：接入 Sentry 或类似服务，自动上报异常
- [ ] **Dashboard**：简易运维面板，查看活跃用户、对话量、系统负载

### 11. 测试与工程质量

当前状态：Vitest 测试文件约 55+，覆盖 runtime、indexing、Notebook chat、routes、utils 和基础 E2E smoke test；lines/statements 覆盖率约 72%+，functions 约 75%；GitHub Actions CI 已落地，含独立 Docs Links 检查 job；ESLint / Prettier / strict mode 仍未引入。

- [x] **自动化测试底座**：已建立 Vitest 测试配置与覆盖率统计，runtime / indexing / Notebook chat / runs API / tool-ops 等路径已有回归测试
- [x] **基础端到端测试**：已具备 chat HTTP API 的 smoke test，覆盖完整 SSE 对话主链路
- [x] **CI/CD**：GitHub Actions 已自动跑 build + test + web build + docs links check（`.github/workflows/ci.yml`）
- [x] **文档链接校验**：`scripts/check-doc-links.mjs` 零依赖校验 Markdown 相对链接有效性，`npm run docs:check` 可本地运行

- [ ] **单元测试**：为核心模块（tool executor、chat service、notebook service）补齐测试
- [ ] **集成测试**：模拟完整对话流程的端到端测试
- [ ] **代码质量**：引入 ESLint + Prettier 统一代码风格
- [ ] **TypeScript strict mode**：启用更严格的类型检查

### 12. 浏览器扩展增强

当前状态：支持划词保存、X.com 推文、Gemini 对话、飞书 Wiki。

- [ ] **侧边栏对话**：扩展内直接与 Neo 对话，不需要切换到 Web UI
- [ ] **页面总结**：一键总结当前页面内容
- [ ] **更多网站适配**：支持 GitHub、Notion、Medium 等主流网站的内容提取
- [ ] **快捷键唤起**：全局快捷键快速打开扩展面板

---

## 实施建议

> 最后更新：2026-05-16，基于第二轮 PM 审计结论。

1. **P0 已基本完成**：多模态、沙箱、工具体系核心能力均已落地，当前重心转向 P1/P2 提升
2. **最高优先级缺口（2026-05-16）**：
   - **批注辅助面板**（F14）：是文章批注功能的最大未完成体验缺口
   - **Workflow 向导/模板**（O11/U12）：JSON 编辑器阻碍了普通用户使用 Workflow
   - **RAG Embedding 向量化**（P1.4）：产品与竞品最大能力差距，建议 SQLite + vss 起步
3. **渐进式推进**：每个大功能拆成多个小 PR，先实现最小可用版本再迭代
4. **向量化可用 SQLite + vss 起步**：不依赖外部服务，改动量最小，收益直接体现在记忆检索质量上
5. **MCP 生态持续扩展**：已有 stdio transport，后续可补充 HTTP/SSE transport 以支持远程 MCP Server
6. **技术债务优先级**：3 个既有 delete route 测试失败（B9）和 13 个文档断链（B10）应尽快修复，恢复 CI 全绿状态
