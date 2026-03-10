# 🧠 Neo — 个人知识操作系统 v5.0

> **定位**：数字分身与全能助手。本地优先、代理驱动、中文语义。  
> **架构原则**：Root-Flat · Local-First · Agentic First · Chinese Semantics

---

## 📐 目录结构

```text
neo/
├── apps/               # 核心应用与服务 (4 层架构实现)
│   ├── extension/      # [表现层] Chrome 划词保存与剪藏插件
│   ├── gateway/        # [网关层] Telegram Bot 服务，鉴权、会话管理与进程调度
│   ├── mcps/           # [底座层] Model Context Protocol 服务 (如 memory-server)
│   ├── refinery/       # [底座层] 离线短作业脚本与清洗管道 (butler, curator, clipper 等)
│   └── wechat/         # [底座层] 微信数据爬取与清理脚本
├── history/            # 历史记录、日记、会话日志与存档
│   ├── inbox/          # 原始素材、网页剪藏、临时收集入口
│   └── memory/         # 系统生成的每日/每月摘要、会话压缩记忆
├── project/            # 进行中的项目日志与参考资料 (如 Neo 设计文档、数据分析等)
└── system/             # 系统配置、提示词工程与 AI 核心资产
    ├── GEMINI.md       # AI 核心指令、基座配置与路由规则
    ├── persona/        # AI 人格设定 (Xifeng, Writer 等)
    └── skill/          # AI 技能组件 (CleanCollect, Summarize, WriteWiki 等)
```

---

## 🏛️ 4 层演进架构 (Agentic Architecture)

目前 Neo 项目正向着完全解耦的 4 层架构演进，实现表现层、网关逻辑、大模型推理与底层工具的完全隔离。

### 1. 表现层 (UI Clients)
**实现目录**: `apps/extension/` 等  
- **功能**: 负责提供最前端的交互界面。目前以 Telegram 机器人和浏览器 Extension 为主，未来可扩展至 Web-UI、Obsidian 插件等。跨端无极漫游，真正形成“数字孪生”。

### 2. 协议与会话层 (Gateway)
**实现目录**: `apps/gateway/`  
- **功能**: 承担 Sentinel 的职责。负责接收事件、鉴权、队列排队（P-Queue 防止并发冲突）、维持短期会话历史，并与底层 CLI 引擎进行 JSON-RPC (Stdio) 通信。
- **价值**: 进程级防火墙隔离。底层模型崩溃时不影响网关响应，可截获错误并平滑重启。

### 3. 推理引擎层 (Engine / CLI)
**实现形式**: 独立进程 (如 `gemini-cli`)  
- **功能**: 专注执行 ReAct 深度推理并调用下游工具，极简可插拔，可横移替换到 claude-cli 或 ollama。
- **价值**: 引擎即插件，摆脱大厂绑定，实现本地私有化或降本增效的算力调度。

### 4. 原子化能力底座 (Capabilities / MCPs)
**实现目录**: `apps/mcps/`, `apps/refinery/`  
- **功能**: 挂载给推理引擎的独立工具链。包括文件读写服务（memory-server）、清洗与归档脚本（butler, curator 等 Refinery 作业）以及外部 API 动作。
- **价值**: 沉淀全生命周期的原子化系统能力，供上层 AI 大脑自由拼接。

---

## 🤖 AI 智能路由与配置驱动

系统的所有提示词与 AI 行为策略均遵循**配置驱动**原则。
核心行为配置在 `system/GEMINI.md`，不再将提示词硬编码在 Node.js 代码中。

| 人格 | 文件 | 适用场景 |
|------|------|----------|
| 🤖 Butler | 默认态 | 文件整理、清理目录、维护元数据等低认知基础设施任务 |
| 🎩 西风 | `system/persona/Xifeng.md` | 方向决策、战略审计、分析人性、寻找逻辑漏洞 |
| 🌋 Writer | `system/persona/Writer.md` | 长文撰写、构建系统化 Wiki、将碎片化知识结晶 |

---

## ⚙️ 快速启动指南

### 1. Gateway (Telegram Bot)
作为主要的 AI 交互入口：
```bash
cd apps/gateway
cp .env.example .env  # 填入 Token 等环境变量
npm install
npm run dev           # 开发模式
# 或通过 pm2 / ecosystem.config.js 启动守护进程
```

### 2. Mind Extension (Chrome 插件)
划词保存工具，将网页内容或推文一键保存为 Markdown 到本地 `inbox`：
- 进入 `chrome://extensions/` → 开发者模式 → 加载已解压扩展程序 → 选择 `apps/extension/`

### 3. MCP 服务与 Refinery 脚本
- **MCP 服务**：在 `apps/mcps/memory-server/` 等目录下执行 `npm install` 及相应启动编译命令，通过 Gateway 暴露工具给大模型 CLI 使用。
- **Refinery**: 存放于 `apps/refinery/` 中的脚本（如 `butler.ts`）可直接运行，执行数据清洗或自动化归档任务。未来将进一步向 MCP 架构融合。

---

## 📋 Git 规则

本项目 `.gitignore` 排除以下敏感或生成内容：
- `.env`（含各类私钥和 Token）
- `node_modules/`, `logs/`, `dist/`, `.DS_Store`
- Python `__pycache__/` 
- `.neo_chat_history.json` 及其他缓存/运行时生成文件

---

*Neo v5.0 · Local-First · Agentic · 2026*
