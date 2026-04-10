# Neo (inkClaw Sentinel)

> 基于 Gemini 的个人 AI 助手服务，提供 Web 界面、Telegram Bot 接入与一套可扩展的工具/技能体系。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **AI 对话** | 基于 Gemini 的多轮对话，支持上下文管理、会话压缩、异步长任务 |
| **笔记 Inbox** | 轻量碎片记录，支持标签、日期筛选、热力图统计 |
| **Notebook** | 文章/知识条目管理，含全文搜索 |
| **Todo** | 待办事项，支持到期提醒与 Cron 定时触发 |
| **Skills** | Markdown 定义的可复用 AI 技能，支持参数插值与代码块执行 |
| **Tools** | 自动发现的工具插件：网页搜索、天气、AI 新闻、图片生成、文件编辑等 |
| **浏览器扩展** | Chrome 划词保存，支持 X.com 推文、Gemini 对话、飞书 Wiki |
| **Web UI** | React 前端，提供 Chat / Notebook / Todo / Notes / Crons 五个面板 |

---

## 技术栈

- **运行时**：Node.js (ESM) + TypeScript
- **后端框架**：Koa 3
- **数据库**：SQLite（better-sqlite3，WAL 模式）
- **LLM**：Google Gemini API（流式输出、函数调用）
- **前端**：React 18 + Vite + Tailwind CSS
- **进程管理**：PM2

---

## 项目结构

```
neo/
├── src/                    # 后端 TypeScript 源码
│   ├── main.ts             # 应用入口
│   ├── server.ts           # Koa HTTP 服务器
│   ├── config.ts           # 集中配置（环境变量）
│   ├── llm/                # LLM 客户端（Gemini Provider）
│   ├── routes/             # HTTP 路由（自动发现）
│   ├── services/           # 业务逻辑层（DB、Chat、Notes、Todo…）
│   ├── skills/             # Skill 定义、解析与执行
│   ├── tools/              # Tool 插件（自动发现）
│   └── utils/              # 公共工具（logger、audit、workspace…）
├── web/                    # React 前端
│   └── src/
│       ├── components/     # Chat / Notebook / Todo / Notes / Crons 面板
│       ├── stores/         # Zustand 状态管理
│       └── api.ts          # 后端 API 客户端
├── extension/              # Chrome 浏览器扩展
├── space/                  # 用户工作区（AGENTS.md / SOUL.md / TOOLS.md / memory）
├── data/                   # SQLite 数据库目录
├── logs/                   # 运行日志
└── ecosystem.config.cjs    # PM2 配置
```

---

## 快速开始

### 前置条件

- Node.js ≥ 20
- npm ≥ 10
- Google Gemini API Key

### 安装依赖

```bash
# 根目录（后端）
npm install

# 前端
npm run web:install
```

### 环境变量

在项目根目录创建 `.env` 文件：

```dotenv
# ── 必填 ──────────────────────────────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key

# ── AI 工作区 ──────────────────────────────────────────────────────
WORK_DIR=/path/to/your/workspace        # AI 可操作的文件目录
AGENT_CONFIG_DIR=/path/to/agent/config  # 存放 AGENTS.md / SOUL.md 的目录

# ── Web 服务 ───────────────────────────────────────────────────────
WEB_PORT=3000
SESSION_SECRET=change-me-in-production  # 用于签名 Cookie，生产环境务必修改

# ── 数据库 ─────────────────────────────────────────────────────────
DB_PATH=./data/neo.db

# ── Gemini 模型 ────────────────────────────────────────────────────
# 可选，支持别名：flash → gemini-3-flash-preview，pro → gemini-3-pro-preview
# GEMINI_MODEL=flash

# ── Telegram（可选）──────────────────────────────────────────────────
# TELEGRAM_BOT_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id

# ── 飞书（可选）──────────────────────────────────────────────────────
# FEISHU_APP_ID=your_app_id
# FEISHU_APP_SECRET=your_app_secret

# ── 浏览器（用于网页抓取 Skill，可选）────────────────────────────────
# CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# BROWSER_CDP_PORT=9222
```

### 开发模式

```bash
# 启动后端（带热重载）
npm run dev:bot

# 启动前端开发服务器（另开终端）
npm run web:dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:3000`。

### 生产部署

```bash
# 构建 TypeScript + 前端
npm run build
npm run web:build

# 使用 PM2 启动
npm run pm2:start

# 查看状态 / 日志
npm run pm2:status
npm run pm2:logs
```

---

## API 路由

所有 API 路径以 `/api/` 为前缀，需携带有效 Session Cookie（`/api/auth/login` 除外）。

| 路由文件 | 路径前缀 | 说明 |
|----------|----------|------|
| `routes/chat.ts` | `/api/chat` | 会话与消息管理 |
| `routes/note.ts` | `/api/notes` | Inbox 笔记 CRUD |
| `routes/notebook.ts` | `/api/notebook` | 知识条目 CRUD |
| `routes/todo.ts` | `/api/todos` | 待办事项 CRUD |
| `routes/session.ts` | `/api/session` | 会话控制 |
| `routes/user.ts` | `/api/auth` | 登录/用户信息 |
| `routes/me.ts` | `/api/me` | 个人资料 |

---

## Tools（工具插件）

工具文件放置于 `src/tools/` 下任意子目录，导出 `Tool` 对象后**自动注册**，无需手动引入。

内置工具：

| 工具 | 路径 | 说明 |
|------|------|------|
| `get-datetime` | `utility/get-datetime.ts` | 获取当前时间 |
| `get-weather` | `utility/get-weather.ts` | 查询天气 |
| `search-web` | `web/search-web.ts` | 网页搜索 |
| `fetch-url` | `web/fetch-url.ts` | 抓取 URL 内容 |
| `fetch-ai-news` | `web/fetch-ai-news.ts` | 聚合 AI 新闻 |
| `generate-image` | `content/generate-image.ts` | 图片生成 |
| `run-skill` | `skills/run-skill.ts` | 调用命名 Skill |
| `edit-file` | `workspace/edit-file.ts` | 文件编辑 |
| `glob` | `workspace/glob.ts` | 文件查找 |
| `grep` | `workspace/grep.ts` | 全文搜索 |
| `notebook` | `workspace/notebook.ts` | 操作知识库 |
| `update-now` | `workspace/update-now.ts` | 更新 NOW.md |

---

## Skills（技能系统）

技能以 Markdown 文件形式定义，存放于 `space/<userId>/skills/` 目录。支持 YAML frontmatter 声明参数，正文作为 AI 系统指令，可通过 `{{param_name}}` 语法注入参数。

示例 frontmatter：

```yaml
---
name: summarize
description: 对输入内容进行摘要
parameters:
  properties:
    content:
      type: string
      description: 需要摘要的文本
  required:
    - content
---
```

---

## 用户工作区

每位用户在 `space/<userId>/` 下拥有独立工作区：

```
space/<userId>/
├── AGENTS.md    # AI 主提示词（身份、行为准则）
├── SOUL.md      # 个性/价值观补充（可选）
├── TOOLS.md     # 工具使用说明（可选）
├── USER.md      # 用户基本信息
├── memory/
│   ├── NOW.md   # 当前状态/上下文
│   └── daily/   # 日记
├── skills/      # 用户自定义 Skill
└── archives/    # 归档文件
```

---

## 浏览器扩展

`extension/` 目录包含一个 Chrome 扩展，支持：

- 划词选中后一键保存到 Inbox
- 保存 X.com 推文（含线程）
- 保存 Gemini 对话（保留代码格式）
- 保存飞书 Wiki 文档

**安装方式**：进入 `chrome://extensions/` → 开启开发者模式 → 加载已解压扩展程序，选择 `extension/` 目录。

---

## 许可证

MIT
