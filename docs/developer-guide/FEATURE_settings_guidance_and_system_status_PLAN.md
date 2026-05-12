# Settings Guidance And System Status Dev Plan

## Scope

This plan implements the first usable slice of `docs/product/FEATURE_settings_guidance_and_system_status.md`.

Phase 1 focuses on Web UX changes that can reuse current APIs:

- Replace the remaining browser-native destructive confirmation with `ConfirmDialog`.
- Add a `Settings / Basic / Overview` entry that aggregates existing readiness data.
- Split settings navigation into Basic and Advanced groups without rewriting each existing tab.
- Add actionable inline errors for model loading, Telegram preferences, MCP save, and automation save failures.
- Update user-facing docs for the new settings structure and readiness card.

Out of scope for this slice:

- A new backend `GET /api/system-status` aggregator.
- A full settings center redesign.
- Reworking the runtime tool approval protocol.
- Adding a full Web component test harness.

## Frontend Design

### Settings IA

`web/src/components/SettingsPanel.tsx` owns the top-level settings routes.

The route set becomes:

- `/settings` and `/settings/overview`: Basic / Overview
- `/settings/models`: Basic / Models
- `/settings/skills`: Basic / Skills
- `/settings/apps`: Advanced / Apps
- `/settings/mcp`: Advanced / MCP Servers
- `/settings/automations`: Advanced / Automations

The top navigation should display two compact groups: Basic and Advanced. Advanced tabs remain directly reachable by URL and by one click in the same bar.

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

Each non-ready item provides one primary action, such as retrying, opening Models, or opening Automations.

### Actionable Errors

Use persistent inline banners near the failing panel, while keeping toasts for short outcome feedback.

Initial coverage:

- Model data load failure: retry and open model setup.
- Telegram preference load/toggle failure: open credential area and retry.
- MCP save failure: keep technical detail visible and point to required fields.
- Cron save failure: keep technical detail visible and point to required fields.

## Testing And Verification

Automated coverage for Web components is not currently configured in this repo. For Phase 1, verification is:

- `npm --prefix web run build` for TypeScript and Vite build validation.
- `npm run docs:check` for documentation links.
- Browser smoke check on `/settings`, `/settings/models`, and `/settings/automations` when a healthy dev server is available.

If later slices add `GET /api/system-status`, backend readiness mapping should receive unit tests under `src/**/__tests__`.

## Documentation Updates

Update the following when implementation lands:

- `docs/user-guide/AGENT_RUNTIME.md`: settings overview, readiness card, and repair entry points.
- `README.md`: first-run instructions should point to Settings / Basic / Overview and Models.
- `CHANGELOG.md`: record the UX change.
- `docs/product/PRODUCT_EXPERIENCE_REVIEW_2026-05-10.md`: mark the recommendation as in-progress or partially implemented.
- `docs/product/ROADMAP.md`: note the P1 settings clarity/status slice.

## Follow-Up

Phase 2 can add a backend `GET /api/system-status` endpoint with structured error codes, workspace path readiness, recent automation run health, and richer repair metadata.
