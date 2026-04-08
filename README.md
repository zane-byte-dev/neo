# 🔭 inkClaw Sentinel

inkClaw Sentinel 是一个多端智能助手（支持 Telegram 和 飞书），通过 Gemini API 提供 AI 回复，支持多轮对话历史、异步长任务执行、自动化任务巡检以及本地知识库联动。

## 📌 最近更新

**[2026-04 Refactoring & Multi-Platform]** 完成了重大架构升级：
- 🌐 **多端支持**：正式引入 Feishu (飞书) 适配器，实现 Telegram 与 飞书 双端并行。
- 🏗️ **租户架构**：引入 Tenant 概念，每个用户/群聊拥有独立的上下文、任务队列与配置。
- 📦 **存储升级**：从文件 JSON 缓存迁移至 SQLite (Better-SQLite3)，提升并发性能与数据可靠性。
- ✅ **命令模块化**：彻底解耦命令逻辑，支持动态加载与多端共享。
- 🔒 **安全加固**：内置危险命令拦截、提示注入防护与异步审计日志。

## 功能特性

- 💬 **双端对话**：支持 Telegram Bot 与 飞书机器人，具备多轮上下文记忆。
- 🤖 **Agent 推理**：直接调用 Gemini API (Function Calling 模式) 进行深度思考与工具调用。
- ⚡ **异步引擎**：支持 `调研` / `重构` 等长耗时任务后台异步执行，完成后主动推送。
- 🕐 **Cron 自动化**：每日 Butler 管家巡检 (02:00)、Curator 内容策展 (09:30) 及周报生成。
- 🗂️ **知识库联动**：深度集成本地 Markdown 知识库，支持搜索、归档与 Wiki 自动生成。
- 📱 **跨平台一致性**：手机、电脑、网页端体验统一。
- 🚀 **PM2 生产级运行**：支持进程管理与自动重启。

## 系统要求

- **Node.js** 18.0.0+
- **Google Gemini API Key**
- **Telegram Bot Token** (可选)
- **Feishu App ID/Secret** (可选)

## 安装

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下核心项：

```bash
WORK_DIR=/path/to/project    # 核心知识库路径

# Gemini 配置
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash-exp

# Telegram 配置
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...         # 授权使用的 Chat ID

# 飞书配置
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_USER_ID=...           # 授权使用的用户 ID (或 open_id)
```

## 使用方法

### 开发模式

```bash
npm run dev:bot
```

### 生产模式 (PM2)

```bash
# 构建并启动
npm run pm2:start

# 查看状态与日志
npm run pm2:status
npm run pm2:logs
```

## 项目结构

```
src/
├── platform/        # 平台适配器 (Telegram, Feishu)
├── commands/        # 模块化命令处理 (Core, Workspace, Task, etc.)
├── services/        # 核心服务 (Gemini, DB, TaskManager, Reminder, etc.)
├── core/            # 核心逻辑 (消息路由, 任务处理, 生命周期)
├── handlers/        # 媒体与特殊消息处理 (Photo, Voice, Url, etc.)
├── tools/           # AI 工具集 (Function Calling 注册工具)
├── crons/           # 定时任务 (Butler, Curator)
└── utils/           # 通用工具 (Logger, FileSearch, Audit)
```

## 技术栈

- **TypeScript** - 核心语言
- **Telegraf** - Telegram 框架
- **@larksuiteoapi/node-sdk** - 飞书 SDK
- **Better-SQLite3** - 本地存储引擎
- **Execa** - 子进程安全执行
- **Puppeteer** - 浏览器自动化服务
- **P-Queue** - 并发控制队列
- **node-cron** - 自动化调度

## License

MIT

## 作者

Zhengchao - inkClaw Project
