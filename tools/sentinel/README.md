# 🔭 NeoAgent Sentinel

NeoAgent Sentinel 是一个 Telegram Bot 智能助手，通过 Gemini CLI 提供 AI 回复，并自动将对话保存到 Obsidian 笔记库。

## 功能特性

- 💬 Telegram Chat Bot 对话模式
- 🤖 调用 Gemini CLI 进行深度思考
- 📝 对话自动保存到 Obsidian vault
- ⚡ 异步队列处理，快速响应
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

# Telegram Bot 配置
TELEGRAM_BOT_TOKEN=your_bot_token   # 从 @BotFather 获取
TELEGRAM_CHAT_ID=your_chat_id       # 你的 Telegram Chat ID
```

### 3. 获取 Telegram Chat ID

```bash
npm run dev:get-chat-id
```

然后在 Telegram 中向你的 Bot 发送任意消息，即可获取 Chat ID。

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

在 Telegram 中发送消息：

```
如何使用 Node.js 处理异步任务？
```

Bot 立即回复：

```
🧠 Thinking...

🤖 NeoAgent (13:46)

您可以使用 async/await 或 Promise 来处理异步任务...
```

对话会自动保存为 Markdown 文件到 Obsidian vault（需配置 `CONVERSATION_SAVE_DIR`）。

## 项目结构

```
NeoAgent-sentinel/
├── src/
│   ├── lib/
│   │   ├── gemini-client.ts      # Gemini CLI 客户端
│   │   ├── conversation-saver.ts # 对话保存到 Obsidian
│   │   └── markdown-converter.ts # Markdown → Telegram 格式
│   ├── telegram-bot.ts           # Telegram Bot 主程序
│   └── get-chat-id.ts            # 获取 Chat ID 工具
├── ecosystem.config.js           # PM2 配置
├── tsconfig.json                 # TypeScript 配置
└── .env                          # 环境变量配置
```

## 技术栈

- **TypeScript** - 类型安全
- **Telegraf** - Telegram Bot 框架
- **Execa** - 子进程执行（Gemini CLI）
- **P-Queue** - 异步任务队列
- **PM2** - 进程管理器

## 故障排查

### 找不到 Gemini CLI

1. 确认 Gemini CLI 已安装并在 PATH 中
2. 或在 `.env` 中设置完整路径：`GEMINI_CLI_PATH=/usr/local/bin/gemini`

### Telegram Bot 无响应

- `TELEGRAM_BOT_TOKEN` 是否正确
- `TELEGRAM_CHAT_ID` 是否正确（运行 `npm run dev:get-chat-id` 获取）
- Bot 是否有网络连接

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
