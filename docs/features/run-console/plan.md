# Run Console Dev Plan

## Status

Draft. No implementation has started.

## Scope

First slice implements a read-mostly UI over the existing Agent Runtime data:

- Runs list page.
- Run detail timeline.
- Status and entrypoint filters.
- Cancel action for running runs.
- Basic redaction and truncation for tool inputs/results.

Out of scope for the first slice:

- Checkpoint resume UI.
- Per-tool retry.
- Full metrics dashboard.
- Editing or mutating historical run records.

## Backend Plan

Reuse existing runtime routes where possible:

- `GET /api/runs?limit=50`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events?cursor=N&limit=200`
- `POST /api/runs/:id/cancel`

Additions if current responses are insufficient:

- Include derived fields in `GET /api/runs`: duration, toolCallCount, artifactCount, lastError, displayTitle.
- Add a small event normalization helper that maps raw runtime events to UI-friendly timeline rows.
- Add a shared redaction helper for event payloads and tool args.

Suggested files:

- `src/routes/runs.ts`
- `src/runtime/store.ts`
- `src/runtime/types.ts`
- `src/runtime/event-summary.ts` (new, if needed)

## Frontend Plan

Suggested files:

- `packages/web/src/components/RunConsole.tsx`
- `packages/web/src/components/RunTimeline.tsx`
- `packages/web/src/lib/runEvents.ts`
- `packages/web/src/api.ts`
- `packages/web/src/components/SettingsPanel.tsx`

UI steps:

1. Add `Settings / Advanced / Runs` route.
2. Fetch recent runs and render compact status table.
3. Add filters for status and entrypoint.
4. Load selected run events and render timeline.
5. Wire cancel action for running runs.
6. Add empty, loading and error states.

## Redaction Rules

- Hide keys matching `token`, `secret`, `apiKey`, `password`, `authorization`.
- Truncate long text values in list rows.
- Keep full raw data out of the DOM unless explicitly safe.
- For tool results, show preview and link to existing full-result endpoint only when available and safe.

## Testing

Backend:

- Unit test event summary/redaction helper.
- Route test for run list derived fields if new fields are added.
- Existing cancel route tests should remain valid.

Frontend:

- If no component test harness exists, run `npm --workspace neo-web run build` and browser smoke.
- Browser smoke should cover list load, detail load, failed run view and cancel button disabled/enabled state.

Validation commands:

```bash
npm run build
npm --workspace neo-web run build
npm run docs:check
```

## Documentation Updates

- Update [AGENT_RUNTIME.md](../../user-guide/AGENT_RUNTIME.md) with Run Console usage.
- Update [AUTOMATION.md](../../user-guide/AUTOMATION.md) to link run history from Workflow/Cron debugging.
- Add test report after implementation.

## Risks

- Runtime events may contain sensitive tool args; redaction must land before broad UI exposure.
- Very long event streams need pagination or incremental loading.
- Current event types may not have stable UI labels; introduce mapping without changing persisted history format.