---
description: Run InkBrain Telegram Chat Bot
---

# Run InkBrain Telegram Chat Bot

Interactive conversation mode - ask questions directly in Telegram.

## Features

- 💬 Direct conversation with InkBrain
- 🤖 Instant replies to your questions
- 📱 Works on iPhone, Mac, and any device with Telegram
- 🔄 Long polling for real-time responses

## Start Bot

// turbo-all
```bash
source venv/bin/activate
python telegram_bot.py
```

Stop with `Ctrl+C`

## Background Mode

```bash
source venv/bin/activate
nohup python telegram_bot.py > telegram_bot.log 2>&1 &
echo $! > telegram_bot.pid
```

## Stop Background Service

```bash
kill $(cat telegram_bot.pid)
rm telegram_bot.pid
```

## View Logs

```bash
tail -f telegram_bot.log
```

## Using the Bot

1. Find your bot in Telegram
2. Click **Start**
3. Send any message to ask a question
4. Receive instant reply!

## Supported Commands

- `/start` - Welcome message
- `/help` - Show help
- `/about` - About InkBrain

## Example Conversation

```
You: 如何使用 Python 处理文件？

Bot: 🤔 正在思考...

Bot: 🤖 InkBrain Reply
你的问题：如何使用 Python 处理文件？
[AI generated response]
⏰ 2026-02-09 23:35:00
```
