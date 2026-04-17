# Neo (inkClaw Sentinel)

> 基于 Gemini 的个人 AI 助手服务，提供 Web 界面、Telegram Bot 接入与一套可扩展的工具/技能体系。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **AI 对话** | 基于 Gemini 的多轮对话，支持流式输出、函数调用、子 agent 派生 |
| **Notebook** | 文章/知识条目管理，含全文搜索 |
| **Skills** | Markdown 定义的可复用 AI 技能，支持参数插值与代码块执行 |
| **Tools** | 内置工具 + 用户自定义工具（`.tools/` 目录自动发现） |
| **Telegram Bot** | Telegraf 长轮询接入，支持 Markdown 渲染、图片发送 |
| **浏览器扩展** | Chrome 划词保存，支持 X.com 推文、Gemini 对话、飞书 Wiki |
| **Web UI** | React 前端，提供 Chat / Notebook 面板 |

---

## 技术栈

- **运行时**：Node.js ≥ 18 (ESM) + TypeScript
- **后端框架**：Koa 3
- **LLM**：Google Gemini API / DeepSeek API / Ollama 本地模型（AI SDK，流式输出 + 函数调用）
- **Telegram**：Telegraf 4
- **前端**：React 19 + Vite + Tailwind CSS 4
- **进程管理**：PM2

---

## 项目结构

```
neo/
├── src/                    # 后端 TypeScript 源码
│   ├── main.ts             # 应用入口（启动 HTTP 服务 + Telegram Bot）
│   ├── server.ts           # Koa HTTP 服务器
│   ├── config.ts           # 集中配置（环境变量）
│   ├── platforms/          # 平台接入（telegram-bot.ts）
│   ├── llm/                # LLM 客户端（AI SDK + Gemini Provider）
│   ├── routes/             # HTTP 路由
│   ├── services/           # 业务逻辑层（agent-runner、chat、notebook、user…）
│   ├── skills/             # Skill 定义、解析与执行
│   ├── tools/              # 内置工具（internal/）+ 用户工具加载（user-tools/）
│   ├── types/              # TypeScript 类型声明
│   └── utils/              # 公共工具（logger、workspace…）
├── web/                    # React 前端
│   └── src/
│       ├── components/     # Chat / Notebook 面板
│       ├── stores/         # Zustand 状态管理
│       └── api.ts          # 后端 API 客户端
├── extension/              # Chrome 浏览器扩展
├── space/                  # 用户工作区 + config.json 用户注册
│   └── <userId>/           # AGENTS.md / SOUL.md / TOOLS.md / memory / skills / .tools
├── logs/                   # 运行日志（JSONL 格式，按日切分）
└── ecosystem.config.cjs    # PM2 配置
```

---

## 快速开始

### 前置条件

- Node.js ≥ 18
- npm ≥ 10
- Google Gemini API Key（或 DeepSeek API Key / 本地 Ollama）

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
# ── 必填（至少配置一个 LLM 提供商）────────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key

# ── Web 服务 ───────────────────────────────────────────────────────
WEB_PORT=3000
SESSION_SECRET=change-me-in-production  # 用于签名 Cookie，生产环境务必修改

# ── Gemini 模型 ────────────────────────────────────────────────────
# 可选，支持别名：flash → gemini-3-flash-preview，pro → gemini-3-pro-preview
# GEMINI_MODEL=flash

# ── Gemini CLI ACP（可选）─────────────────────────────────────────────
# 通过 Gemini CLI 的 OAuth 配额（Google One AI Premium）使用 Gemini，无需 API Key
# 需先安装并登录 gemini CLI：https://github.com/google-gemini/gemini-cli
# GEMINI_CLI_PATH=gemini             # gemini CLI 可执行路径，默认 "gemini"

# ── DeepSeek（可选）───────────────────────────────────────────────────
# 接入 DeepSeek API，支持 deepseek-chat / deepseek-reasoner 模型
# DEEPSEEK_API_KEY=your_deepseek_key

# ── Ollama 本地模型（可选）────────────────────────────────────────────
# 通过本地 Ollama 运行 Gemma 等开源模型，适合隐私敏感场景
# OLLAMA_BASE_URL=http://localhost:11434/v1   # 默认值

# ── Telegram（可选）──────────────────────────────────────────────────
# TELEGRAM_BOT_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id       # 兼容兜底，建议用 config.json tenants

# ── 日志 ───────────────────────────────────────────────────────────
# LOG_LEVEL=info                       # debug | info | warn | error
# DEBUG_LLM=1                          # 等价于 LOG_LEVEL=debug
```

### 开发模式

```bash
# 编译并启动后端（包含 HTTP 服务 + Telegram Bot）
npm run dev:bot

# 启动前端开发服务器（另开终端）
npm run web:dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:3000`。

### 生产部署（Mac Mini / 长期运行）

生产环境只需运行一个进程。Koa 后端在同一端口（默认 3000）同时提供 API 和前端静态文件（`web/dist/`），无需额外的静态服务器。

#### 首次部署

```bash
# 1. 安装全局工具（如果还没有）
npm install -g pm2

# 2. 安装依赖
npm install
npm run web:install

# 3. 一键构建并启动
npm run deploy
# 等价于: tsc + npm run web:build + pm2 start ecosystem.config.cjs

# 4. 设置开机自启
pm2 startup       # 按提示执行输出的 sudo 命令
pm2 save          # 保存当前进程列表
```

#### 后续更新

```bash
git pull
npm run deploy:restart
# 等价于: tsc + npm run web:build + pm2 restart inkClaw-bot
```

#### 常用运维命令

```bash
npm run pm2:status   # 查看进程状态
npm run pm2:logs     # 实时日志（Ctrl+C 退出）
npm run pm2:restart  # 重启所有进程
npm run pm2:stop     # 停止所有进程
```

#### 域名 + HTTPS（可选，推荐 Caddy）

```bash
brew install caddy
```

`/etc/caddy/Caddyfile`：

```
neo.moshuia.com {
    reverse_proxy localhost:3000
}
```

```bash
brew services start caddy
# Caddy 会自动申请并续期 Let's Encrypt 证书
```

#### 架构示意

```
[浏览器 / Telegram]
        │
  neo.moshuia.com
        │  (Caddy HTTPS 反代，可选)
        ▼
  Koa Server :3000  ← PM2 守护
  ├── /api/*        → 路由处理（AI 对话 / Notebook / 文件上传…）
  └── /*            → web/dist/ 静态文件
```

---

## API 路由

所有 API 路径以 `/api/` 为前缀，需携带有效 Session Cookie（`/api/auth/login` 除外）。

| 路由文件 | 路径前缀 | 说明 |
|----------|----------|------|
| `routes/chat.ts` | `/api/chat` | SSE 流式对话 |
| `routes/upload.ts` | `/api/upload` | 文件上传（PDF / Word / Excel / 图片等） |
| `routes/notebook.ts` | `/api/notebook` | 知识条目 CRUD |
| `routes/session.ts` | `/api/session` | 会话管理 |
| `routes/user.ts` | `/api/auth` | 登录/用户信息 |
| `routes/me.ts` | `/api/me` | 个人资料 |
| `routes/assets.ts` | `/api/assets` | 会话生成的静态资源（图片、视频） |
| `routes/reload.ts` | `/api/reload` | 热重载用户缓存（编辑 AGENTS.md 等后调用） |
| `routes/webhook.ts` | `/api/webhook/:userId` | 外部系统触发 Agent（需 webhookSecret） |

---

## Tools（工具系统）

### 内置工具（`src/tools/internal/`）

| 工具 | 说明 |
|------|------|
| `bash` / `read_file` / `write_file` / `list_dir` | 基础文件系统 + Shell 操作（`src/tools/executor.ts`） |
| `edit_file` | 精确局部文件编辑 |
| `glob` | 按模式查找文件 |
| `grep` | 正则搜索文件内容 |
| `fetch_url` | 抓取网页内容 |
| `search_web` | 网络搜索 |
| `research` | 深度网络调研（自动搜索+阅读+综合报告） |
| `get_datetime` | 获取当前日期时间 |
| `get_weather` | 查询天气 |
| `save_memory` | 保存长期记忆 |
| `todo` | 会话内任务跟踪 |
| `run_skill` / `list_skills` | 执行/列出已注册 Skill |
| `subagent` | 派生子 agent 执行独立子任务 |
| `ask_user` | 向用户提问确认 |
| `enter_plan_mode` / `exit_plan_mode` | 计划模式（限制写操作） |
| `generate_video` | 视频生成（Google Veo 3.1，4-8 秒短视频，需 GEMINI_API_KEY） |
| `update_user_profile` | 读取/更新用户档案 USER.md（记录长期偏好与背景信息） |

### 用户工具（`space/<userId>/.tools/`）

每个子目录包含 `tool.yaml`（声明）+ `run.py`/`run.sh`（执行脚本），自动发现并注册。

| 工具 | 说明 |
|------|------|
| `generate_image` | AI 图片生成（Gemini） |
| `fetch_ai_news` | 聚合 Reddit/HN AI 新闻 |
| `notebook` | 文件系统知识库操作 |
| `update_now` | 更新短期记忆（NOW.md） |

---

## 多模型支持

Neo 支持多种 LLM 提供商，通过统一的别名系统切换：

| 别名 | 实际模型 | 提供商 | 说明 |
|------|---------|--------|------|
| `flash` | gemini-3-flash-preview | Google Gemini API | 快速响应，适合日常任务 |
| `pro` | gemini-3-pro-preview | Google Gemini API | 高质量推理 |
| `gemini-acp` | Gemini (via CLI) | Gemini CLI OAuth | 使用 Google One AI Premium 配额，无需 API Key |
| `deepseek` | deepseek-chat | DeepSeek API | 成本低，工具调用可靠 |
| `deepseek-reasoner` | deepseek-reasoner | DeepSeek API | 深度推理 |
| `gemma` | ollama/gemma4:e4b | 本地 Ollama | 离线/隐私场景 |

**智能路由（auto 模式）**：当用户选择 `auto` 时，`model-router.ts` 会根据任务特性自动选择最优模型：
- 需要工具调用 → DeepSeek（工具调用可靠且成本低）
- 纯对话/分析 → Gemini ACP（质量最高，OAuth 配额）
- ACP 不可用 → Gemini flash
- 无云服务 Key → 本地 Gemma

---

## Skills（技能系统）

技能以 Markdown 文件形式定义，存放于 `space/<userId>/skills/` 目录。支持 YAML frontmatter 声明参数，正文作为 AI 系统指令，可通过 `{{param_name}}` 语法注入参数。

内置 Skills：`brief`、`summarize_text`、`generate_daily_log`、`generate_weekly_report`、`generate_wechat_article`、`js_snippet_runner`、`xifeng`（决策审计）

---

## 用户工作区

用户注册在 `space/config.json`，每位用户在 `space/<userId>/` 下拥有独立工作区：

```
space/config.json            # 用户列表、tenant 绑定、webToken
space/<userId>/
├── AGENTS.md    # 任务路由与工具调用规则
├── SOUL.md      # 身份与沟通风格
├── TOOLS.md     # 工具使用指引
├── USER.md      # 用户基本信息
├── memory/
│   ├── NOW.md   # 当前关注点/近况
│   └── daily/   # 每日日记
├── skills/      # 用户自定义 Skill
├── .tools/      # 用户自定义工具（tool.yaml + run.py）
└── notebooks/   # 知识库文件
```

Telegram 绑定在 `space/config.json` 里通过 tenants 声明：

```json
{
  "users": [
    {
      "id": "8094416266",
      "name": "zc",
      "tenants": ["telegram:8094416266"],
      "webToken": "8094416266"
    }
  ]
}
```

---

## 核心架构

```
用户消息 → [HTTP SSE / Telegram Bot]
              ↓
         agent-runner.ts（共享一轮对话逻辑）
              ↓
      calcUser → session → history → LLM streaming → save
              ↓
         LLM Client (AI SDK + Gemini)
              ↓
      Tool calls → executor.ts → internal tools / user tools
                                → subagent（递归调用）
```

- `src/services/agent-runner.ts`：封装完整的「一次对话轮次」生命周期，HTTP 和 Telegram 共用
- `src/platforms/telegram-bot.ts`：Telegraf 长轮询，fire-and-forget 模式避免 90 秒超时，Markdown→HTML 渲染
- `src/routes/chat.ts`：SSE 流式推送，通过 `onChunk` / `onImage` / `onTodo` 回调接收输出

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
