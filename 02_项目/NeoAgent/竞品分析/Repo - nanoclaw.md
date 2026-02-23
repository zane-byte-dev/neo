---
title: Repo - nanoclaw (Personal Claude Assistant in Apple Containers)
url: https://github.com/gavrielc/nanoclaw
type: technical-reference
tags: [AI, Claude, macOS, Security, WhatsApp, Personal-Assistant]
date: 2026-02-03
---

# NanoClaw

> **Core Philosophy**: Small enough to understand. Secure by isolation. Built for one user.

## Why I Built This
OpenClaw is an impressive project with a great vision. But I can't sleep well running software I don't understand with access to my life. NanoClaw gives you the same core functionality in a codebase you can understand in 8 minutes. One process. A handful of files. Agents run in actual Linux containers with filesystem isolation, not behind permission checks.

## Quick Start
```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
claude
```
Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup, service configuration.

## Features
- **WhatsApp I/O**: Message Claude from your phone.
- **Isolated Group Context**: Each group has its own `CLAUDE.md` memory and isolated filesystem.
- **Main Channel**: Private admin control via self-chat.
- **Scheduled Tasks**: Recurring jobs that run Claude and can message you back.
- **Web Access**: Search and fetch content.
- **Container Isolation**: Agents sandboxed in Apple containers (macOS Tahoe+).

## Architecture
WhatsApp (baileys) --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response

### Key Files
- `src/index.ts`: Main app: WhatsApp connection, routing, IPC.
- `src/container-runner.ts`: Spawns agent containers.
- `src/task-scheduler.ts`: Runs scheduled tasks.
- `src/db.ts`: SQLite operations.
- `groups/*/CLAUDE.md`: Per-group memory.

## Skills (The NanoClaw way)
Instead of adding features to the core, users contribute **Skills**.
- `/add-telegram`: Add Telegram support.
- `/add-slack`: Add Slack support.
- `/convert-to-docker`: Use Docker instead of Apple Containers.

## Usage Examples
- `@Andy send an overview of the sales pipeline every weekday morning at 9am`
- `@Andy review the git history for the past week each Friday and update the README if there's drift`
- `@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch`

---
*Captured from GitHub on 2026-02-03.*
