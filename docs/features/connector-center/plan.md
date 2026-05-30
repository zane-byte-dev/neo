# Connector Center Dev Plan

## Status

Draft. No implementation has started.

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

- `web/src/components/ConnectorCenter.tsx`
- `web/src/components/ConnectorTemplateForm.tsx`
- `web/src/lib/connectorTemplates.ts`
- `web/src/api.ts`
- `web/src/components/SettingsPanel.tsx`

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
npm --prefix web run build
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