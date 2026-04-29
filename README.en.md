# Neo

[![CI](https://github.com/ChaoZheng/neo/actions/workflows/ci.yml/badge.svg)](https://github.com/ChaoZheng/neo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> A self-hosted personal AI assistant: web chat + notebook knowledge base +
> Telegram bot, with a pluggable tool/skill system and multi-LLM routing
> (Gemini, DeepSeek, OpenAI, Anthropic, Ollama).

[中文版 README →](README.md)

---

## Why Neo?

- **Single-tenant by design** — your conversations, notebooks, and tool runs
  live on disk in your own workspace directory. No vendor lock-in.
- **Multi-LLM routing** — automatically picks the best model for the task
  (tool-heavy → DeepSeek, reasoning → Gemini Pro, offline → Ollama).
- **Tools and skills are just files** — drop a `tool.yaml` + `run.py` into your
  workspace and Neo discovers it on the next reload. Skills are Markdown.
- **Runs anywhere** — a Mac mini under your desk, a $5 VPS, or your laptop.
  One Node process serves both the API and the React frontend.

## Features

| Module | Description |
|--------|-------------|
| **AI chat** | Multi-turn streaming chat with function calling and sub-agent spawning |
| **Notebook** | Article / knowledge-item store with full-text search (SQLite FTS5) |
| **Skills** | Markdown-defined reusable AI skills with parameter interpolation |
| **Tools** | Built-in tools + user-defined tools auto-loaded from `<workspace>/tools/` |
| **Telegram bot** | Telegraf long-polling, Markdown rendering, image / video sending |
| **Browser extension** | Chrome extension for clipping selections, X.com threads, Gemini chats, Lark wiki pages |
| **Web UI** | React 19 + Vite + Tailwind CSS, Chat / Notebook panels |

## Tech Stack

- **Runtime:** Node.js ≥ 18 (ESM) + TypeScript
- **Backend:** Koa 3, better-sqlite3
- **LLM:** Vercel AI SDK with Google Gemini / DeepSeek / OpenAI / Anthropic / Ollama
- **Frontend:** React 19 + Vite + Tailwind CSS 4
- **Process manager (prod):** PM2

## Quick Start

```bash
git clone https://github.com/ChaoZheng/neo.git
cd neo
npm install && npm run web:install

cp .env.example .env
# Edit .env: set at least GEMINI_API_KEY and change USERS[].workDir
# to an absolute path on your machine.

npm run dev:bot          # backend + Telegram bot on :3000
npm run web:dev          # frontend dev server on :5173 (separate terminal)
```

Open http://localhost:5173 and start chatting.

### Production (single Node process behind Caddy)

```bash
npm install -g pm2
npm install && npm run web:install
npm run deploy           # tsc + web build + pm2 start
pm2 startup && pm2 save  # auto-start on boot
```

The Koa backend serves both `/api/*` and the static `web/dist/` frontend on the
same port (default `3000`). Put it behind Caddy / Nginx / Cloudflare for HTTPS.

## Configuration

All configuration is in `.env`. Required:

- `USERS` — JSON array of users; each must have a `workDir`
  (absolute path) and a `webToken`.
- `SESSION_SECRET` — long random string for signing session cookies.
- At least one LLM provider key: `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`,
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or a local `OLLAMA_BASE_URL`.

Optional: `TELEGRAM_BOT_TOKEN`, `WEB_PORT`, `LOG_LEVEL`, `DAILY_COST_LIMIT`.
See [.env.example](.env.example) for the full list.

## Workspace Layout

Each user has an independent workspace directory:

```
<workDir>/
├── AGENTS.md          # task-routing and tool-call rules
├── SOUL.md            # persona / communication style
├── TOOLS.md           # tool usage guide
├── USER.md            # user profile
└── notebooks/         # knowledge base
```

## Project Structure

```
neo/
├── src/                 # Backend (TypeScript, ESM)
│   ├── main.ts          # Process entry (HTTP + Telegram)
│   ├── server.ts        # Koa app
│   ├── services/        # agent-runner, chat, notebook, user…
│   ├── routes/          # HTTP routes
│   ├── llm/             # Multi-provider LLM client + router
│   ├── tools/           # Built-in tools + user-tool loader
│   ├── skills/          # Skill loader and executor
│   ├── indexing/        # SQLite FTS5 knowledge index
│   ├── memory/          # Episodic + semantic memory
│   ├── runtime/         # Resumable agent run state
│   └── utils/           # Logger, file-search, git-auto-commit…
├── web/                 # React frontend
├── extension/           # Chrome browser extension
└── docs/                # Design docs and roadmap
```

## Browser Extension

Load `extension/` as an unpacked extension via `chrome://extensions/` →
"Load unpacked". It supports clipping web selections, X.com tweets/threads,
Gemini chat exports, and Lark wiki pages directly into your Neo inbox.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Short version: stabilizing the agent
runtime (resumable runs, tool-confirmation scopes), expanding the unified
knowledge index, and improving the Notebook editor experience.

## Contributing

Pull requests are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md) first. For security issues,
follow the disclosure process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 ChaoZheng
