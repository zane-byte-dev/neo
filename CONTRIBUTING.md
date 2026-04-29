# Contributing to Neo

Thank you for your interest in contributing! This document explains how to
get a development environment running and what we expect from pull requests.

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<your-fork>/neo.git
cd neo

# 2. Install dependencies (backend + frontend)
npm install
npm run web:install

# 3. Configure environment
cp .env.example .env
# Edit .env: set USERS[].workDir to an absolute path you control,
# and provide at least one LLM API key (GEMINI_API_KEY recommended).

# 4. Run in dev mode
npm run dev:bot       # backend on http://localhost:3000
npm run web:dev       # frontend on http://localhost:5173 (separate terminal)
```

## Project Layout

See the [Project Structure](README.md#项目结构) section in the README. The
key entry points are:

- `src/main.ts` — process entry (HTTP server + optional Telegram bot)
- `src/services/agent-runner.ts` — the shared "one chat turn" lifecycle
- `src/tools/` — built-in tools and the user-tool loader
- `web/src/` — React frontend
- `extension/` — Chrome browser extension

## Development Workflow

1. **Create a branch** off `main` (e.g. `feat/my-feature`, `fix/bug-name`).
2. **Make focused commits.** Prefer small, reviewable PRs over giant ones.
3. **Run the full check locally before pushing:**

   ```bash
   npm run build              # TypeScript type-check
   npm test                   # Vitest suite
   npm --prefix web run build # Frontend build
   ```

4. **Open a pull request** against `main` and fill in the PR template.

## Coding Conventions

- TypeScript, ESM-only (`"type": "module"` in `package.json`).
- Node.js ≥ 18.
- Follow the existing style in nearby files; don't introduce new formatting
  conventions in a single PR.
- Prefer composing existing utilities (`src/utils/`) over re-implementing.
- Don't add features beyond what the issue/PR describes.
- Don't sprinkle docstrings or type annotations on code you didn't change.

## Tests

- Tests live next to source files in `__tests__/` directories.
- Run a single file: `npx vitest run path/to/file.test.ts`.
- Tests that touch `chat-service` need `process.env.USERS` set with a valid
  `workDir`. See `src/__tests__/test-helpers.ts`.
- New features should come with tests. Bug fixes should come with a regression
  test that fails before the fix.

## Commit Messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(chat): add slash-command palette
fix(indexing): handle empty chunk on rebuild
docs(readme): clarify Ollama setup
chore(deps): bump vitest to 2.1
```

The prefix is optional but appreciated — it makes generating release notes
easier.

## Reporting Bugs

Open an issue using the bug-report template. Please include:

- Neo commit SHA (`git rev-parse HEAD`).
- Node.js version (`node -v`).
- OS.
- Reproduction steps and expected vs actual behavior.
- Relevant log lines from `logs/<date>.jsonl` (redact secrets first).

## Security Issues

Please do **not** file public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
