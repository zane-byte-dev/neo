# Lazy Tool Context Dev Plan

## Status

First slice implemented (2026-06-23). Lazy tool documentation is the default for
chat turns; full mode remains available as a per-user fallback.

### Discovery during implementation

`buildBuiltinToolsGuide()` (the `builtin-guide.ts` block this plan assumed was the
prompt-side injection point) is **not wired into the live system prompt** — it is
only exercised by tests, and per-user `TOOLS.md` files carry tool docs instead.
The real per-request tool-context token lever is `buildAiTools()` in
[src/llm/ai-tools.ts](../../../src/llm/ai-tools.ts), which hands every tool's full
`description` + `inputSchema` to the AI SDK on each turn.

The first slice therefore applies lazy documentation at that real lever: in lazy
mode `buildAiTools()` replaces each tool's full description with its one-line
catalog summary (schemas stay intact so calls remain valid), and the new
`search_tools` tool expands full detail on demand. The compact catalog renderer
(`builtin-guide.ts` `compact` mode) is implemented and tested as a reusable
foundation for any future prompt-side injection.

### Delivered

- `src/tools/tool-catalog.ts` — single metadata source: `buildToolCatalog`,
  `summaryFor`, `renderCompactCatalog`, `lookupToolDetail`, `renderToolDetail`,
  shared `TOOL_SUMMARIES` / `TOOL_DISPLAY_ORDER`.
- `src/tools/builtin-guide.ts` — `buildBuiltinToolsGuide(registry, mode, context)`
  with `compact` mode; `full` mode byte-compatible with the legacy output.
- `src/tools/internal/search-tools.ts` — `search_tools` (read tier), respects
  plan / notebook filtering, matches by `name` / `query` / `category`.
- `ToolContext.toolDocsMode` + `UserPreferences.toolContext` (`'lazy'` default,
  `'full'` fallback); threaded through `agent-runner.ts`.
- `buildAiTools()` lazy descriptions (schemas untouched; `search_tools` always
  keeps its full description).

### Not yet done (follow-ups)

- Surfacing `toolContext` in the Settings UI (config source exists; default is
  enough to validate).
- Prompt-side compact-catalog injection (renderer ready, but no live injection
  point currently consumes it).
- Token-delta measurement against `usage.jsonl` (Phase 4).
- Lazy docs for workflow / subagent / skill execution paths (currently full).

## Scope

First slice introduces a compact tool catalog in the system prompt plus a `search_tools` tool that expands full tool detail on demand, with a config switch to fall back to full injection.

Included:

- Compact tool catalog generation (name + one-line purpose + permission tier).
- `search_tools` internal tool returning full description / schema / examples.
- Per-tool detail metadata source shared by catalog and `search_tools`.
- Config switch `toolContext: 'lazy' | 'full'`.
- Plan/notebook mode compatibility.

Not included:

- Embedding-based semantic tool retrieval.
- Forced MCP tool lazy loading.
- Removing `builtin-guide.ts` (extended, not removed).
- Changing the execution path in `executeTool()`.

## Architecture Plan

### Tool Detail Registry

Suggested files:

- `src/tools/tool-catalog.ts` (new)

Responsibilities:

- Provide a single source of per-tool metadata: `name`, `summary` (one line), `permission`, `detail` (full description), `schema`, `examples`.
- Derive entries from `TOOL_DECLARATIONS`, `toolRegistry`, and (optionally) user/MCP tools.
- Expose `buildCompactCatalog(registry, context)` and `lookupToolDetail(query, registry, context)`.

### Compact Catalog Injection

Suggested files:

- `src/tools/builtin-guide.ts`

Approach:

- Add a `mode: 'compact' | 'full'` parameter to the guide builder.
- In `compact` mode, emit only the `name | summary | permission` table.
- Keep `full` mode behavior byte-compatible with today for fallback.

### `search_tools` Tool

Suggested files:

- `src/tools/internal/search-tools.ts` (new)
- `src/tools/executor.ts` (register declaration)

Behavior:

- Input: `{ name?: string; query?: string; category?: string }`.
- Output: full detail for matched tools (description, schema, examples, caveats).
- Respect read-only modes: filter results through `isAllowedInPlanMode`.
- Permission tier: `read`.

### Wiring

Suggested files:

- `src/llm/ai-tools.ts`
- the system-prompt assembly path that currently calls `buildBuiltinToolsGuide()`

Approach:

- Read `toolContext` from user config/prefs.
- When `lazy`, inject compact catalog and register `search_tools`.
- When `full`, preserve current behavior and skip `search_tools`.
- `buildAiTools()` keeps registering all executable tools regardless of mode — lazy only affects injected documentation, not callability.

### Config

Suggested files:

- `src/config.ts`
- `src/services/user-prefs.ts`

Approach:

- Add `toolContext` with default `'lazy'`.
- Surface in Settings later (out of scope for first slice; default is enough to validate).

## Phases

### Phase 1: Tool Catalog Source

- Build `tool-catalog.ts` with compact + detail accessors.
- Unit test catalog entries cover all built-in + registry tools.

### Phase 2: Compact Injection + Switch

- Add `compact` mode to `builtin-guide.ts`.
- Add `toolContext` config with `lazy` default and `full` fallback.
- Verify full mode output is unchanged.

### Phase 3: search_tools

- Implement and register `search_tools`.
- Enforce plan/notebook filtering.
- Confirm a tool expanded via `search_tools` can then be invoked in the same loop.

### Phase 4: Measurement

- Add a token-delta assertion (or manual `usage.jsonl` comparison) demonstrating reduced prompt tokens on a multi-tool session.

## Testing

Backend:

- `tool-catalog.ts` unit tests (compact vs detail, permission tiers).
- `search-tools.ts` tests for name/query/category matching and plan-mode filtering.
- `builtin-guide.ts` snapshot test asserting compact vs full output.
- Regression: `full` mode output equals current implementation.

Validation commands:

```bash
npm run build
npx vitest run src/tools src/llm
npm run docs:check
```
