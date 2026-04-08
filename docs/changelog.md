# inkClaw

这是一个本地化的AI助手，基于本地文件建立知识库，Git负责版本管理，直接调用 Gemini SDK 作为 AI Agent。
项目分为三个子仓库：`inkClaw-brain`（知识库）、`inkClaw-core`（网关与工具）、`inkClaw-tools`（辅助脚本）。
在 `inkClaw-core/gateway/config` 目录下存放了 AI 的系统配置和工具。

## 目前已经实现的

### 极简架构底座
纯本地 Markdown + Git 版本管理，`inkClaw-brain` 确立 `inbox/history/user` 分区，实现 Local-First。

### 自动化记忆生命周期
会话即日志 (Session-to-Log)，通过 Telegram Bot 网关实现碎片注入，自动向 `history/memory/` 沉淀记录。

### 多重 AI 人格切换
通过 `system/persona` 实现“管家(基建)”、“西风(决策审计)”、“作家(输出沉淀)”等不同人格的精准调用。

### 技能工作流 (Skills)
通过 `system/skill` 定义了一套标准动作协议，包含日记骨架生成、碎片清理、账本记录等。

### 全平台入口打通
实现了 Telegram -> Local Vault 的闭环链路，能够随时随地向 Inbox 注入碎片。

## 还需要实现的

### 主动策展推送 (The Curator)
基于 Node.js 定时唤醒，自动检索历史记录进行每日知识策展并主动推送到终端。

### UI 界面层解耦重构
基于 Electron 外壳对接 Gemini SDK，实现轻量桌面端交互层。

### 向量增强检索 (RAG)
优化本地 Markdown 的 Embedding 与索引性能，实现模糊意图检索和主动联想搜索。

### 全自动看板刷新
根据项目区下的变更记录和 commit，让 AI 自动生成或更新各大看板的当前进度。



## change log

### 2026-04-05
- **[Feature] 多平台支持 (Multi-Platform)**：正式引入 **Feishu (飞书)** 适配器，支持企业级协同场景。
- **[Architecture] 租户架构 (Tenant Architecture)**：实现租户隔离，每个独立会话（Telegram/Feishu）拥有专属的 `TenantContext`。
- **[Storage] SQLite 迁移**：全面转向 `better-sqlite3` 持久化存储，对话历史、异步任务、提醒等数据实现高效 SQL 管理。
- **[Core] 流程归一化**：重构 `MessageRouter` 与 `TaskProcessor`，统一多端消息处理流程。

### 2026-03-20
- **[Refactor] 命令模块化**：将单体命令处理逻辑拆分为 8 个核心模块 (`core`, `workspace`, `task`, `reminder`, etc.)。
- **[Security] 安全加固**：上线 `AuditLogger` 审计日志系统，内置针对 Bash 注入、危险指令执行的防御机制。
- **[Core] 直接调用 SDK**：彻底移除外部 CLI 依赖，通过 Gemini SDK 直接驱动 Function Calling，显著降低延迟。
- **[Tooling] 浏览器服务**：集成 Puppeteer-core，支持网页内容的动态抓取与分析。

### 2026-03-14
彻底去除 gemini-cli 依赖，底层全面迁移为直接调用 Gemini SDK（FunctionCalling 模式），响应速度大幅提升。
重构项目目录结构，拆分为 `inkClaw-brain`（知识库）、`inkClaw-core`（网关）、`inkClaw-tools`（工具脚本）三仓分离架构。
`inkClaw-core/gateway/config` 取代原 `system/` 目录，承载 AI 系统配置（SOUL、AGENTS、TOOLS、WriteWiki）。

### 2026-03-04
彻底重构知识库物理与逻辑架构，确立“Logs + 维度账本 (Ledgers)”分发体系。
废弃手动日记模版，转向“会话即日志 (Session-to-Log) + 自动脱水 (Dehydration)”的全自动化审计流。
调研 QoderWork 技术栈（Electron+CLI+node-pty），确认 inkClaw 后续 UI/终端交互路径。
确立 “node-pty 对接 gemini-cli” 的 UI 交付路径，实现 Electron 壳与 CLI 大脑的工程解耦。
利用 AI 通过 Git commit 历史与 OKR 自动对齐生成绩效自评。

### 2026-02-01
架构扁平化，确立 `inbox/project/history/reference/system` 五大支柱。

### 2026-02-04
inkClaw Typeless（录音提纯）原型跑通，探索原生音频理解。

### 2026-02-09
完成 Browser Plugin 链路与生图 (Imagine) 能力。

### 2026-02-10
全链路打通 (Telegram <-> Local Vault)；项目正式命名为 inkClaw。

### 2026-02-21
激活 Google AI Pro，移除对学生优惠代理的依赖，确保模型主权。

### 2026-02-22
维持 Mac Air M1 为核心运载，暂不购入无头主机。

### 2026-02-23
架构简化] 剥离 Obsidian/iCloud 依赖，回归纯 Git 本地仓库；全面收敛至 v5.0 核心哲学（Root-Flat & Local-First）。

### 2026-02-24
重构 `system/` 命名，上线 `写Wiki` Skill V2.0。

### 2026-02-25
底层重构为 SDK+FunctionCalling，调用提速。

### 2026-02-25
**inkClaw Desktop v1 MVP 达成**。基于 Tauri + React 实现了原生的三栏桌面端设计，打通本地文件与 AI 侧边栏的无缝联动。

### 2026-02-27
奥卡姆剃刀实践，技术栈从 Tauri 回撤至 Electron（后确立为原生+CLI混合模式）。

### 2026-01-19
实现 CLI + 浏览器插件闭环，inkClaw 正式跑通。

### 2026-01-22
inkClaw Gardener v2.0 重构完成，集成语义混合检索（Embedding API）。

### 2026-01-26
废弃复杂脚本，转为 "Interactive Automation" 交互式模式，数据回归 Local-First。

### 2026-01-27
启用 Google Antigravity (Claude 4.5)，停用 Cursor 订阅；重构 Clipper 插件。