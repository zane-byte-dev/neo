# 🔭 NeoAgent Sentinel

NeoAgent Sentinel 是一个 Telegram Bot 智能助手，通过 Gemini CLI（ACP 协议）提供 AI 回复，支持多轮对话历史缓存、后台异步长任务执行与定时巡检。

## 功能特性

- 💬 Telegram Chat Bot 对话模式，支持多轮上下文记忆
- 🤖 通过 ACP 协议调用 Gemini CLI 进行深度思考与工具调用
- ⚡ 同步任务队列（P-Queue）+ 异步后台任务并发处理
- 🔁 关键词自动路由：以 `调研` / `重构` 开头或使用 `/research` 命令触发后台异步任务
- 📋 异步任务状态跟踪与主动推送（任务完成后自动通知）
- 🕐 Cron 定时任务：每日 02:00 Butler 管家巡检、09:30 Curator 内容策展
- 🗂️ 对话历史本地缓存（Session 超时自动归档）
- 📱 手机、电脑、网页全平台支持
- 🚀 PM2 后台运行

## 系统要求

- **Node.js** 18.0.0+
- **Gemini CLI**（用于 AI 回复）
- **Telegram Bot Token**（从 @BotFather 获取）

## 安装

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# Gemini CLI 配置
GEMINI_CLI_PATH=gemini              # Gemini CLI 可执行文件路径
GEMINI_TIMEOUT=180                  # 超时时间（秒）
GEMINI_WORK_DIR=/path/to/project    # 项目根目录（用于 Cron 脚本和异步任务）

# Telegram Bot 配置
TELEGRAM_BOT_TOKEN=your_bot_token   # 从 @BotFather 获取
TELEGRAM_CHAT_ID=your_chat_id       # 你的 Telegram Chat ID

# 对话历史缓存配置
CHAT_CACHE_DIR=./cache              # 缓存目录（默认 ./cache）
CHAT_SESSION_TIMEOUT_HOURS=1        # Session 超时时间（小时，默认 1）
CHAT_MAX_HISTORY_MESSAGES=20        # 每个 Session 最大消息数（默认 20）
CHAT_MAX_CONTEXT_TOKENS=3000        # 上下文最大 token 数（默认 3000）
```

### 3. 获取 Telegram Chat ID

启动开发模式但先不配置 `TELEGRAM_CHAT_ID`：

```bash
npm run dev:bot
```

然后在 Telegram 中向你的 Bot 发送任意消息，查看终端控制台输出，即可获得类似 `[Message] From xxx (ID: 123456789)` 的日志信息，拿到 Chat ID 后填入 `.env` 并重启。

## 使用方法

### 开发模式

```bash
npm run dev:bot
```

### 生产模式（PM2）

```bash
# 构建并启动
npm run pm2:start

# 查看运行状态
npm run pm2:status

# 查看日志
npm run pm2:logs

# 重启 / 停止
npm run pm2:restart
npm run pm2:stop
```

### 手动编译和运行

```bash
npm run build
npm run start:bot
```

## 工作流程

### 普通对话

在 Telegram 中发送消息，Bot 立即进入任务队列并回复：

```
如何使用 Node.js 处理异步任务？
```

Bot 立即回复：

```
🧠 Thinking...

🤖 NeoAgent (13:46)

您可以使用 async/await 或 Promise 来处理异步任务...
```

每轮对话的上下文由 `ChatHistoryCache` 本地持久化，Session 超时后自动归档。

### 异步后台任务

以 `调研` 或 `重构` 开头的消息，或使用 `/research <prompt>` 命令，会被路由到后台异步引擎：

```
调研 2025年大模型推理加速的主流方案
```

Bot 立即确认任务编号：

```
👌 任务已启动，ID: #abc123。
正在进入独立引擎处理 (如 Deep Research)。
你可以继续聊天，处理完我会主动推送结果。
```

任务完成后自动推送：

```
✅ 后台任务 #abc123 异步完成:

...（详细研究结果）
```

### Cron 定时任务

| 时间    | 任务       | 描述                           |
|---------|------------|--------------------------------|
| 02:00   | Butler     | 每日管家巡检，自动维护项目状态 |
| 09:30   | Curator    | 每日内容策展报告               |

## 项目结构

```
gateway/
├── src/
│   ├── lib/
│   │   ├── acp-client.ts         # Gemini ACP 协议客户端（JSON-RPC over stdio）
│   │   ├── async-task-manager.ts # 异步后台任务调度与状态持久化
│   │   ├── chat-history-cache.ts # 多轮对话历史 Session 缓存
│   │   ├── gemini-client.ts      # Gemini 高层封装（同步/异步对话）
│   │   ├── logger.ts             # 全局带时间戳日志工具
│   │   └── markdown-converter.ts # Markdown → Telegram MarkdownV2 格式转换
│   └── telegram-bot.ts           # Telegram Bot 主程序
├── cache/
│   └── chat_history.json         # 对话历史持久化文件
├── ecosystem.config.js           # PM2 配置
├── tsconfig.json                 # TypeScript 配置
└── .env                          # 环境变量配置
```

## 技术栈

- **TypeScript** - 类型安全
- **Telegraf** - Telegram Bot 框架
- **Execa** - 子进程执行（Gemini CLI / ACP）
- **P-Queue** - 同步任务队列（并发控制）
- **node-cron** - Cron 定时任务
- **PM2** - 进程管理器

## 故障排查

### 找不到 Gemini CLI

1. 确认 Gemini CLI 已安装并在 PATH 中
2. 或在 `.env` 中设置完整路径：`GEMINI_CLI_PATH=/usr/local/bin/gemini`

### ACP 进程启动失败

- 确认 Gemini CLI 版本支持 `--experimental-acp` 参数
- 启动时会自动清理残留的 `gemini --experimental-acp` 进程，若仍有问题可手动执行 `pkill -f "gemini --experimental-acp"`

### Telegram Bot 无响应

- `TELEGRAM_BOT_TOKEN` 是否正确
- `TELEGRAM_CHAT_ID` 是否正确（通过终端日志查看你的真实 ID）
- Bot 是否有网络连接

### Cron 任务未执行

- 确认 `GEMINI_WORK_DIR` 已正确设置，指向包含 `apps/refinery/butler.ts` 和 `apps/refinery/curator.ts` 的项目根目录

## 开发

```bash
# 编译项目
npm run build

# 清理编译输出
npm run clean

# 测试 Gemini Client
tsx src/lib/gemini-client.ts
```

## License

MIT

## 作者

Zhengchao - NeoAgent Project
