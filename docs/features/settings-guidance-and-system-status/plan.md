# Settings Guidance And System Status Dev Plan

## Status

Phase 1 is implemented and accepted as an MVP.

Implemented in this slice:

- Settings now defaults to `Basic / Overview` and groups navigation into Basic and Advanced.
- Overview aggregates existing readiness data from `/api/me`, `/api/models`, `/api/preferences`, and `/api/crons`.
- Sidebar bulk chat deletion uses `ConfirmDialog` instead of `window.confirm`.
- Model loading, Telegram settings, MCP save/load, and automation save/load errors use actionable inline banners.
- User-facing docs, product status, roadmap, changelog, and test report were updated.

Test report: [test-report.md](test-report.md)

## Scope

This plan describes the first usable slice of [brief.md](brief.md).

Phase 1 focused on Web UX changes that reuse current APIs:

- Replace the remaining browser-native destructive confirmation with `ConfirmDialog`.
- Add a `Settings / Basic / Overview` entry that aggregates existing readiness data.
- Split settings navigation into Basic and Advanced groups without rewriting each existing tab.
- Add actionable inline errors for model loading, Telegram preferences, MCP save, and automation save failures.
- Update user-facing docs for the new settings structure and readiness card.

Still out of scope for this slice:

- A new backend `GET /api/system-status` aggregator.
- A full settings center redesign.
- Reworking the runtime tool approval protocol.
- Adding a full Web component test harness.

## Frontend Design

### Settings IA

`web/src/components/SettingsPanel.tsx` owns the top-level settings routes.

The implemented route set is:

- `/settings` and `/settings/overview`: Basic / Overview
- `/settings/models`: Basic / Models
- `/settings/skills`: Basic / Skills
- `/settings/apps`: Advanced / Apps
- `/settings/mcp`: Advanced / MCP Servers
- `/settings/automations`: Advanced / Automations

The top navigation displays two compact groups: Basic and Advanced. Advanced tabs remain directly reachable by URL and by one click in the same bar.

### System Status Card

Phase 1 computes readiness in the browser from existing APIs:

- `GET /api/me`
- `GET /api/models`
- `GET /api/preferences`
- `GET /api/crons`

The card shows:

- Overall state: Ready / Needs attention
- Backend: whether core API calls returned successfully
- Account: current user identity
- Models: configured model count and provider health warnings
- Automation: Telegram runtime and cron job count

Each non-ready item provides a primary action, such as retrying, opening Models, or opening Automations.

### Actionable Errors

The implementation uses persistent inline banners near the failing panel, while keeping toasts for short outcome feedback.

Implemented initial coverage:

- Model data load failure: retry and open model setup.
- Telegram preference load/toggle failure: open credential area and retry.
- MCP save failure: keep technical detail visible and point to required fields.
- Cron save failure: keep technical detail visible and point to required fields.

## Testing And Verification

Automated coverage for Web components is not currently configured in this repo. Phase 1 verification used:

- `npm --prefix web run build`: passed.
- `npm run docs:check`: passed.
- Browser smoke check on `/settings`, `/settings/models`, and `/settings/automations`: passed for rendering and error recovery states.

Note: the shared browser environment returned backend 500 / aborted API requests during smoke testing, so the healthy `Ready` visual state still needs one follow-up smoke check in a healthy runtime. The failure path was verified and is recorded in the test report.

If later slices add `GET /api/system-status`, backend readiness mapping should receive unit tests under `src/**/__tests__`.

## Documentation Updates

Updated during implementation:

- [AGENT_RUNTIME.md](../../user-guide/AGENT_RUNTIME.md): settings overview, readiness card, and repair entry points.
- [README.md](../../../README.md): first-run instructions now point to Settings / Basic / Overview and Models.
- [CHANGELOG.md](../../../CHANGELOG.md): records the UX change.
- [PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md](../../product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md): marks the recommendation as completed for the MVP slice.
- [ROADMAP.md](../../product/ROADMAP.md): records the P1 settings clarity/status slice.
- [test-report.md](test-report.md): records acceptance coverage and residual risks.

## Follow-Up

Phase 2 can add a backend `GET /api/system-status` endpoint with structured error codes, workspace path readiness, recent automation run health, and richer repair metadata.

Recommended Phase 2 follow-ups:

- Verify the Overview `Ready` state in a healthy runtime.
- Split `SettingsOverview` out of `SettingsPanel.tsx` if readiness logic grows further.
- Add backend tests when readiness moves from frontend aggregation to a dedicated system-status route.
