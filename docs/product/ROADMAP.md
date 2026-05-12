# Neo Roadmap

> 功能规划与开发路线图。按优先级分为 P0（核心）、P1（重要）、P2（锦上添花）三档。

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

当前状态：内置 15+ 工具 + 用户自定义工具，已支持 MCP、权限分级和结果缓存。

- [x] **MCP 协议支持**：实现 Model Context Protocol 客户端（stdio transport），通过 `{workDir}/mcp.json` 配置 MCP Server，自动加载远程工具（前缀 `mcp__<server>__<tool>`）
- [x] **工具权限分级**：工具分为 read / write / dangerous 三级（`ToolMeta.permission`），plan mode 下仅允许 read 级别；未标注工具通过启发式推断
- [x] **工具执行确认**：dangerous 级别工具在 `ToolContext.confirmCallback` 存在时会先征求确认，拒绝则返回 `[DENIED]`；Web UI 已接入（Chat 设置里的盾牌图标开启后，在会话中实时弹出 Approve/Deny 按钮）
- [x] **工具结果优化**：tool_result 改为智能截断（头 500 + 尾 200 + 省略标记），完整原文写入内存 LRU 缓存，通过 `GET /api/tool-result/:id` 按需拉取
- [x] **工具重试与容错**：新增 `withRetry` 指数退避工具；已应用于 fetch_url、search_web（仅对 5xx/429/网络错误重试）
- [x] **工具使用统计**：记录每个工具的调用频率、成功率、平均耗时，供优化参考（`GET /api/tool-stats`）

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

当前状态：React 前端有 Chat 和 Notebook 面板，功能完善。

- [x] **Artifact 渲染**：代码块支持语法高亮 + 一键复制；支持折叠超长代码块；支持 Mermaid 图表、数学公式（KaTeX）渲染
- [x] **思维过程展示**：展示 AI 的思考过程（thinking/reasoning chunks）和工具调用过程，可折叠
- [x] **会话管理增强**：会话搜索、批量删除、导出为 Markdown
- [x] **移动端适配**：响应式布局，适配手机和平板（侧边栏抽屉、安全区域、长按菜单）
- [x] **深色/浅色主题**：三主题（Light / Dark / Classic Dark）手动切换
- [x] **键盘快捷键**：Cmd+N 新建会话、Cmd+B 切换侧边栏
- [ ] **语音输入**：Web 端支持录音并转文字（可复用语音转文字能力）

### 7. 工作流与自动化

当前状态：有基本的 cron-agent 定时任务，但缺乏复杂的自动化能力。

- [ ] **工作流引擎**：定义多步骤工作流（YAML/JSON），支持条件分支、循环、并行执行
- [ ] **事件触发器**：文件变更、Webhook 接收、新邮件等事件自动触发工作流
- [ ] **Skill 编排**：多个 Skill 串联执行，前序 Skill 输出作为后序 Skill 输入
- [ ] **定时任务增强**：支持 Web UI 管理定时任务，查看执行历史和日志
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

当前状态：基于 config.json 的简单用户管理，Cookie Session 认证，基础的命令黑名单。

- [ ] **OAuth 登录**：支持 GitHub / Google OAuth，简化注册和登录
- [ ] **API Key 认证**：为 API 调用提供独立的 API Key 机制
- [ ] **速率限制**：按用户/IP 限制 API 调用频率，防止滥用
- [ ] **操作审计日志**：完整记录所有工具调用、文件操作、模型请求，支持查询和导出
- [ ] **工作区隔离加固**：确保用户工具/命令执行严格限制在自己的 workspace 中

### 10. 可观测性与运维

当前状态：控制台日志 + JSONL 文件日志，PM2 进程管理。

- [ ] **结构化 Metrics**：记录 LLM 调用延迟、token 用量、工具执行耗时等关键指标
- [ ] **健康检查端点**：`/health` 端点返回服务状态、依赖连通性
- [ ] **Token 用量追踪**：统计每个用户/会话的 token 消耗量，支持预算告警
- [ ] **错误追踪集成**：接入 Sentry 或类似服务，自动上报异常
- [ ] **Dashboard**：简易运维面板，查看活跃用户、对话量、系统负载

### 11. 测试与工程质量

当前状态：已接入 Vitest（约 45 个测试文件），覆盖 runtime、indexing、Notebook chat、routes 和基础 E2E smoke test；GitHub Actions CI 已落地；ESLint / Prettier / strict mode 仍未引入。

- [x] **自动化测试底座**：已建立 Vitest 测试配置与覆盖率统计，runtime / indexing / Notebook chat / runs API 等路径已有回归测试
- [x] **基础端到端测试**：已具备 chat HTTP API 的 smoke test，覆盖完整 SSE 对话主链路
- [x] **CI/CD**：GitHub Actions 已自动跑 build + test + web build（`.github/workflows/ci.yml`）

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

1. **P0 优先**：多模态、沙箱、工具完善是提升日常使用体验的关键，建议优先实施
2. **渐进式推进**：每个大功能可以拆成多个小 PR，先实现最小可用版本再迭代
3. **多模态可以先做图片理解**：Gemini 原生支持 Vision，改动量最小，收益最大
4. **沙箱可以先做 Docker 基础版**：不需要一步到位，先实现基本的容器隔离
5. **MCP 支持价值很大**：一旦接入 MCP，可以复用大量已有的 MCP Server 生态
