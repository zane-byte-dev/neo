# Lazy Tool Context — Test Report

> Date: 2026-06-23
> Scope: First slice (compact tool catalog source, `search_tools`, lazy
> descriptions in `buildAiTools`, `toolContext` preference).

## What was implemented

| Area | File |
|------|------|
| Tool metadata source | `src/tools/tool-catalog.ts` (new) |
| Compact guide mode | `src/tools/builtin-guide.ts` |
| `search_tools` tool | `src/tools/internal/search-tools.ts` (new) |
| Lazy descriptions | `src/llm/ai-tools.ts` |
| Preference + context field | `src/services/user-prefs.ts`, `src/llm/types.ts` |
| Wiring (default lazy for chat) | `src/services/agent-runner.ts` |

## Key behavior

- Default chat turns now run in **lazy** mode: each tool's AI-SDK `description`
  is reduced to a one-line summary; full parameter schemas are unchanged so all
  tools stay callable.
- `search_tools` (read tier) expands full description + JSON schema on demand by
  `name` / `query` / `category`, and never reveals write/dangerous tools in
  plan or notebook mode.
- `search_tools` keeps its own full description even in lazy mode (escape hatch).
- Setting `UserPreferences.toolContext = 'full'` restores legacy full
  descriptions.

## Automated tests

New:

- `src/tools/__tests__/tool-catalog.test.ts` — catalog tiers, curated/ fallback
  summaries, plan-mode filtering, dedupe, compact rendering, `lookupToolDetail`
  by name/query/category, detail rendering.
- `src/tools/internal/__tests__/search-tools.test.ts` — declaration tier, missing
  params, exact-name detail, miss message, plan-mode hiding, keyword query.
- `src/llm/__tests__/ai-tools.test.ts` (extended) — full descriptions by default,
  one-line summaries in lazy mode, `search_tools` keeps full description, and a
  token-delta assertion proving lazy descriptions are < 60% of full payload
  (Phase 4).

## Commands

```bash
npm run build                              # tsc clean
npx vitest run src/tools src/llm src/services
# → 45 files / 449 tests passed (was 43 / 427: +2 files, +22 tests)
```

## Known limitations

- No Settings UI for `toolContext` yet (config source only).
- No live prompt-side injection of the compact catalog renderer.
- Workflow / skill paths still use full descriptions (subagents inherit lazy
  mode via `buildAiToolSubset`).
