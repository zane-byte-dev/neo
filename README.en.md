# Neo

[![CI](https://github.com/zane-byte-dev/neo/actions/workflows/ci.yml/badge.svg)](https://github.com/zane-byte-dev/neo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> A self-hosted personal AI assistant: web chat + notebook knowledge base +
> automation runtime, with a pluggable tool/skill system.
> The current model runtime uses DeepSeek through the Vercel AI SDK.

[中文版 README →](README.md)

---

## Why Neo?

- **Single-tenant by design** — your conversations, notebooks, and tool runs
  live on disk in your own workspace directory. No vendor lock-in.
- **Agent runtime** — web chat, CLI, webhooks, cron jobs, and workflows all
  share the same resumable run/event model.
- **Tools and skills are just files** — drop tools into `{stateDir}/tools/`
  and Markdown skills into `{stateDir}/skills/`; Neo discovers them on reload.
- **Runs anywhere** — a Mac mini under your desk, a $5 VPS, or your laptop.
  One Node process serves both the API and the React frontend.

## Features

| Module | Description |
|--------|-------------|
| **AI chat** | Multi-turn streaming chat with function calling and sub-agent spawning |
| **Notebook** | Article / knowledge-item store with full-text search, annotations, and in-article resource previews |
| **Skills** | Markdown-defined reusable AI skills with parameter interpolation |
| **Tools** | Built-in tools + user-defined tools auto-loaded from `{stateDir}/tools/` |
| **Automation** | Webhook / Cron / Workflow triggers with serial steps, run history, and manual runs |
| **Browser extension** | Chrome extension for clipping selections, X.com threads, Gemini chats, Lark wiki pages |
| **Web UI** | React 19 + Vite + Tailwind CSS, Chat / Notebook panels |

## Tech Stack

- **Runtime:** Node.js ≥ 18 (ESM) + TypeScript
- **Backend:** Koa 3, better-sqlite3 for the knowledge index
- **LLM:** Vercel AI SDK + DeepSeek Anthropic-compatible API
- **Frontend:** React 19 + Vite + Tailwind CSS 4
- **Process manager (prod):** PM2

## Quick Start

```bash
git clone https://github.com/zane-byte-dev/neo.git
cd neo
npm install && npm run web:install

# Start directly. On first launch, Neo creates ~/.neo/config.json with a
# default single-user setup, random webToken / SESSION_SECRET, and workspace
# directories under ~/.neo/{workspace,state}/default. The login webToken is
# printed in the backend console.

npm run dev:bot          # backend HTTP server on :3000
npm run web:dev          # frontend dev server on :5173 (separate terminal)
```

Open http://localhost:5173 and configure `DEEPSEEK_API_KEY` for model calls.
See [docs/user-guide/FAQ.md](docs/user-guide/FAQ.md) for common setup issues.

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

By default, first launch creates `~/.neo/config.json`. For multi-user setups,
custom paths, or repo-local development, you can still create
`packages/agent/src/config.local.ts` (gitignored). It takes precedence over the home config:

```bash
cp packages/agent/src/config.local.example.ts packages/agent/src/config.local.ts
```

```ts
import type { LocalConfig } from './config.js';

const config: LocalConfig = {
    USERS: [
        {
            id: 'alice',
            name: 'Alice',
            tenants: [],                       // reserved for platform mappings
            webToken: 'long-random-string',    // for web sign-in
            workDir:  '/abs/path/to/workspace',  // your stuff (notebooks, AGENTS.md…)
            stateDir: '/abs/path/to/state',      // managed by Neo (runs, secrets, usage…)
        },
    ],
    SESSION_SECRET: 'change-me-to-a-long-random-string',
};

export default config;
```

The current model runtime reads `DEEPSEEK_API_KEY` from the environment.
Do not commit real web tokens, gateway tokens, or session secrets.

A few optional environment variables are still respected when set:
`WEB_PORT`, `LOG_LEVEL`, and `DAILY_COST_LIMIT`.

## Workspace Layout

Each user gets two directories:

```
<workDir>/                 # yours — commit it to git if you like
├── AGENTS.md           # task-routing and tool-call rules
├── SOUL.md             # persona / communication style
├── TOOLS.md            # tool usage guide
├── USER.md             # user profile
└── notebooks/          # knowledge base markdown

<stateDir>/                # managed by Neo — do not edit by hand
├── secrets.json.enc    # AES-256-GCM encrypted credentials
├── runs/               # resumable agent run event streams
├── projects/           # session files and run artifacts
├── memory/             # episodic + semantic memory
├── notebooks/          # SQLite (FTS5) knowledge index
├── skills/             # user-defined skills
├── tools/              # user-defined tools (tool.yaml + run.py)
├── routing.json        # routing overrides saved from the Models page
├── tool-approvals.json # tool-confirmation session/always rules
├── usage.jsonl         # daily token / cost accounting
```

> 💡 A minimal runnable template lives at [examples/workspace/](examples/workspace)
> (AGENTS.md / SOUL.md / USER.md / TOOLS.md). Copy it to your `workDir` to get started.

## Tools And Skills

Neo injects built-in tools automatically and loads user-defined tools from
`{stateDir}/tools/{name}/tool.yaml` plus a colocated `run.py`, `run.ts`,
`run.js`, or `run.sh`. See [docs/user-guide/TOOLS.md](docs/user-guide/TOOLS.md) and
[examples/tools/](examples/tools) for the full protocol.

Skills are Markdown files under `{stateDir}/skills/`, either as
`name.skill.md` or `name/skill.md`. See [docs/user-guide/SKILLS.md](docs/user-guide/SKILLS.md) and
[examples/skills/](examples/skills) for frontmatter, parameters, interpolation,
and executable blocks.

More user guides:

- [docs/user-guide/SANDBOX.md](docs/user-guide/SANDBOX.md) — sandbox and `code_exec`
- [docs/user-guide/MCP.md](docs/user-guide/MCP.md) — MCP server configuration
- [docs/user-guide/NOTEBOOK.md](docs/user-guide/NOTEBOOK.md) — Notebook sources, notes, Studio, citations
- [docs/user-guide/AUTOMATION.md](docs/user-guide/AUTOMATION.md) — Webhook, Cron, and Workflow automation
- [docs/user-guide/AGENT_RUNTIME.md](docs/user-guide/AGENT_RUNTIME.md) — runs, event logs, resume, cancellation
- [docs/user-guide/BROWSER_EXTENSION.md](docs/user-guide/BROWSER_EXTENSION.md) — Chrome extension

## Verification

```bash
npm run verify
```

This runs TypeScript checks for runtime, agent, app, and web, then executes the full Vitest suite. Use `npm run typecheck` for a faster type-only pass.

## Project Structure

```
neo/
├── packages/
│   ├── app/             # Koa HTTP server, CLI, routes, automation entrypoints
│   ├── agent/           # LLM, agent-runner, tools, skills, memory, notebook
│   └── runtime/         # run/event/checkpoint/pending-action contracts
├── web/                 # React frontend
├── extension/           # Chrome browser extension
└── docs/                # Design docs and roadmap
```

## Browser Extension

Load `extension/` as an unpacked extension via `chrome://extensions/` →
"Load unpacked". It supports clipping web selections, X.com tweets/threads,
Gemini chat exports, and Lark wiki pages directly into your Neo inbox.

## Roadmap

See [docs/product/ROADMAP.md](docs/product/ROADMAP.md). Short version: stabilizing the agent
runtime (resumable runs, tool-confirmation scopes), expanding the unified
knowledge index, and improving the Notebook editor experience.

## Contributing

Pull requests are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md) first. For security issues,
follow the disclosure process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 zane-byte-dev
