# Connector Center Dev Plan

## Status

Backend slice 1 + frontend slice 2 implemented. `mcp.json` stays primary (Option A).

Implemented (Option A — `mcp.json` stays primary):

- `src/mcp/connector-templates.ts` — template catalog (`filesystem`, `github`, `custom-stdio`) with `expandTemplate()` that produces stdio configs and reports missing required fields plus secret keys.
- `src/mcp/test-connection.ts` — `testMcpConnection()` + pure `classifyConnectionError()` returning structured codes (`ok`, `missing_secret`, `cwd_not_found`, `command_not_found`, `process_exited`, `timeout`, `invalid_rpc`, `no_tools`, `unknown`).
- `src/mcp/stdio-client.ts` — spawn `error` events now reject pending requests so `ENOENT` surfaces as `command_not_found` instead of timing out.
- `src/mcp/loader.ts` — reads top-level `disabledTools` from `mcp.json` and filters disabled tools server-side before registration.
- `src/routes/mcp-config.ts` — new routes: `GET /api/mcp/templates`, `POST /api/mcp/test` (draft config or template), `POST /api/mcp/:name/test` (stored server), `PATCH /api/mcp/:name/tools/:tool` (enable/disable). `GET /api/mcp` and `writeConfig` now round-trip `disabledTools`.

Storage decision: `disabledTools` is stored as a top-level map in `{workDir}/mcp.json`. Connector secrets encryption (env values via the secrets service) remains a follow-up; templates already flag secret fields via `secretKeys`.

Frontend (slice 2):

- `packages/web/src/components/SettingsPanel.tsx` (MCP tab) — template picker (Manual / Filesystem / GitHub / Custom stdio) that renders template fields, a **Test connection** action for both draft configs and saved servers showing the structured status code + tool count, and per-tool enable/disable toggles backed by `disabledTools`.
- `packages/web/src/api.ts` — `mcpTemplates()`, `mcpTestDraft()`, `mcpTestServer()`, `mcpToggleTool()`; `mcpList()` now returns `disabledTools`.
- `POST /api/mcp/test` echoes the resolved config so the UI can save a template-expanded server without re-implementing expansion client-side.

Deferred:

- Encrypted storage of connector env secrets (currently written to `mcp.json` like any other env).
- Remote HTTP / OAuth MCP transports.

## Scope

First slice turns MCP server management into a connector-oriented UI while preserving compatibility with existing `{workDir}/mcp.json`.

Included:

- Connector list and status.
- Template-based stdio connector creation.
- Test connection action.
- Encrypted sensitive fields.
- Tool list with enable/disable.

Not included:

- Full remote HTTP MCP transport.
- OAuth callback flow.
- Public connector marketplace.
- MCP resources/prompts UI.

## Storage Plan

Two compatible options:

### Option A: Preserve `mcp.json` as primary config

- Keep non-sensitive command/args/cwd in `{workDir}/mcp.json`.
- Store sensitive values in `{stateDir}/connector-secrets.json.enc` or existing secrets service.
- Store UI metadata and disabled tools in `{stateDir}/connectors/connectors.json`.

### Option B: New connector store as primary config

- Store all connector metadata in `{stateDir}/connectors/connectors.json`.
- Generate MCP runtime config in memory during reload.
- Continue importing existing `{workDir}/mcp.json` for backward compatibility.

Recommendation: start with Option A to reduce migration risk, then move to Option B if connector metadata grows.

## Backend Plan

Suggested services:

- `src/services/connector-service.ts`
- `src/services/connector-secrets.ts` if existing secrets service cannot namespace connector values cleanly.
- Extend `src/mcp/loader.ts` to respect disabled tools and injected secrets.
- Extend `src/mcp/stdio-client.ts` errors so routes can return structured failure codes.

Suggested routes:

- `GET /api/connectors`
- `POST /api/connectors`
- `PUT /api/connectors/:id`
- `DELETE /api/connectors/:id`
- `POST /api/connectors/:id/test`
- `PATCH /api/connectors/:id/tools/:toolName`

Compatibility:

- Existing `/api/mcp` routes can remain during transition.
- `POST /api/reload` should reload connector-derived MCP tools.

## Frontend Plan

Suggested files:

- `packages/web/src/components/ConnectorCenter.tsx`
- `packages/web/src/components/ConnectorTemplateForm.tsx`
- `packages/web/src/lib/connectorTemplates.ts`
- `packages/web/src/api.ts`
- `packages/web/src/components/SettingsPanel.tsx`

UI steps:

1. Add Advanced / Connectors entry or replace MCP Servers tab label.
2. Render connector cards/table with status.
3. Add template creation flow.
4. Add test connection action and inline structured errors.
5. Add tool list with enable/disable toggles.
6. Keep raw JSON editor as advanced fallback for existing users.

## Template MVP

### Filesystem

- Required: allowed directory path.
- Generated command: MCP filesystem server command.
- Risk: path access must be explicit and visible.

### GitHub

- Required: token secret.
- Generated command or remote placeholder depending on selected MCP package.
- Risk: package choice may vary; document supported template clearly.

### Sentry or Notion

- Choose one template with stable MCP server documentation.
- If no stable package is available, ship as “custom stdio template” instead.

## Testing

Backend:

- Unit test connector config normalization.
- Unit test secret redaction.
- Route tests for create/list/test/delete.
- MCP loader test with disabled tool filtering.

Frontend:

- Build verification.
- Browser smoke for create, failed test, connected state, disable tool.

Validation commands:

```bash
npm run build
npm --workspace neo-web run build
npm run docs:check
```

## Documentation Updates

- Update [MCP.md](../../user-guide/MCP.md) to describe Connector Center and legacy `mcp.json` fallback.
- Update [TOOLS.md](../../user-guide/TOOLS.md) with connector-provided tools.
- Add test report after implementation.

## Risks

- Running arbitrary stdio commands is high risk; templates must make command and cwd visible.
- Token handling must avoid writing secrets to version-controlled workspace files.
- Tool enable/disable must be enforced server-side, not only hidden in UI.