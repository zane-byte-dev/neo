# Claude Code Provider Test Report

## Scope

- Add Claude Code compatible endpoint support through `CLAUDE_CODE_BASE_URL` + `CLAUDE_CODE_TOKEN`.
- Verify model aliases, provider availability gating, encrypted secret handling, backend build, and frontend build.

## Automated checks

- Baseline before code changes:
  - `npm test` initially could not run before dependency install (`vitest` missing).
  - After `npm install`, `npm run build` passed.
  - After `npm install`, `cd web && npm run build` passed.
  - After `npm install`, `npm test` had 3 pre-existing failures in notebook/session delete tests unrelated to this provider change.

## Acceptance coverage

- `src/llm/__tests__/client.test.ts` covers `claude-code` alias resolution.
- `src/llm/__tests__/model-router.test.ts` covers Claude Code availability requiring both proxy URL and token.
- `src/services/__tests__/secrets.test.ts` covers encrypted persistence/status for Claude Code proxy URL and token.

## Risks / follow-up

- No live Claude Code proxy was available in this environment, so runtime streaming was validated through build/type checks and alias/provider tests only.
- The token is sent as `Authorization: Bearer <token>` via the Anthropic-compatible provider path.
