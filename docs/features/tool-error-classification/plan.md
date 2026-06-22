# Tool Error Classification Dev Plan

## Status

Draft. No implementation has started.

## Scope

First slice adds a centralized error classifier that tags failed tool results and feeds a structured hint back to the model, cooperating with the existing tool-loop-guard.

Included:

- Error classifier with general heuristics.
- Structured failure hint appended to failed tool results.
- Optional per-tool override via tool `meta`.
- Integration at the `wrapExecute` boundary in `buildAiTools()`.
- Migration of existing `search_web` / `fetch_url` signatures onto the new model.

Not included:

- Automatic retry / backoff (model decides).
- Rewriting all tools' error return formats.
- Replacing `tool-loop-guard` (cooperate, not replace).
- Quota-driven rate limiting changes.

## Architecture Plan

### Error Classifier

Suggested files:

- `src/llm/tool-error-classifier.ts` (new)

Responsibilities:

- `classifyToolError(toolName, result, error?, tool?)` returns `{ type: 'transient' | 'quota' | 'permanent' | 'validation' | 'unknown'; retryable: boolean; suggestion: string }`.
- General heuristics: HTTP status families, `unauthorized/forbidden/权限`, `invalid/参数/schema`, `timeout/network/网络`, rate-limit/`quota` markers.
- Detect failure first (reuse the notion of a failure result, currently `[Error] ...` prefixes) before classifying.

### Structured Hint Injection

Suggested files:

- `src/llm/ai-tools.ts`

Approach:

- In `wrapExecute()`, after `run(args)` returns, classify the result.
- If failed, append a stable structured hint block to the returned string before `guard.record()`.
- Keep the original tool output intact; the hint is additive.

### Per-tool Override

Suggested files:

- `src/llm/types.ts` (extend `ToolMeta`)
- relevant `src/tools/internal/*` tools (opt-in)

Approach:

- Add optional `meta.classifyError?(result): ClassifiedError | null`.
- Classifier consults the override first, then falls back to general heuristics.

### Cooperation With loop-guard

Suggested files:

- `src/llm/tool-loop-guard.ts`

Approach:

- Leave short-circuit responsibility in loop-guard.
- Migrate `search_web` / `fetch_url` failure signatures to express themselves through the classifier (or per-tool override), keeping current short-circuit thresholds.
- Order in `wrapExecute`: `shortCircuit` (before) → run → classify+annotate → `record` (after).

## Phases

### Phase 1: Classifier Core

- Implement `tool-error-classifier.ts` with general heuristics.
- Unit test against representative error strings (HTTP 401/403/429/5xx, network, invalid args, CJK messages).

### Phase 2: Hint Injection

- Wire classifier into `wrapExecute`.
- Assert hint appears for failures and is absent for successes.

### Phase 3: Per-tool Override + Migration

- Extend `ToolMeta`.
- Move `search_web` / `fetch_url` signatures onto classifier/override.
- Verify existing short-circuit regression still passes.

### Phase 4: Optional Observability

- (Stretch) Emit classified failure into `src/runtime/` events for the run console.

## Testing

Backend:

- Classifier unit tests covering each `type` and `retryable` outcome.
- `ai-tools` integration test: failed result gets structured hint; success does not.
- Regression: `tool-loop-guard` short-circuit for `search_web` / `fetch_url` unchanged.
- Per-tool override precedence test.

Validation commands:

```bash
npm run build
npx vitest run src/llm src/tools
npm run docs:check
```
