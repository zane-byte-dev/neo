# Connector Center — Test Report (Backend Slice 1)

## Scope

Backend foundation for the Connector Center: template catalog, structured
connection testing, server-side tool enable/disable, and the supporting routes.
Frontend UI is deferred to slice 2.

## Validation Commands

```bash
npm run build          # tsc — clean, no type errors
npx vitest run src/mcp # 18 tests passed (4 files)
npm --workspace neo-web run build  # clean for connector files (pre-existing MermaidBlock mermaid-types error is unrelated)
```

## Automated Tests

### `src/mcp/__tests__/connector-templates.test.ts`

- `listConnectorTemplates()` returns serializable summaries (no `build` closure) and includes `filesystem`, `github`, `custom-stdio`.
- GitHub `token` field is flagged `secret` + `required`.
- `expandTemplate('filesystem', …)` produces the expected `npx @modelcontextprotocol/server-filesystem <dir>` config.
- Missing required fields are reported in `missing[]`; `secretKeys` is surfaced for the GitHub token.
- `custom-stdio` splits args by whitespace and trims `cwd`.
- Unknown template ids set `unknownTemplate`.

### `src/mcp/__tests__/test-connection.test.ts`

- `classifyConnectionError()` (pure): ENOENT → `command_not_found`, timeout → `timeout`, exit → `process_exited`, bad JSON → `invalid_rpc`, otherwise `unknown`.
- `testMcpConnection()` against the mock stdio server returns `ok` with 1 `echo` tool.
- Missing binary → `command_not_found` (fast, via spawn ENOENT).
- Bad `cwd` → `cwd_not_found` (early return, no spawn).
- Empty env value → `missing_secret` (early return, message names the key).
- Empty command → `command_not_found`.

### `src/mcp/__tests__/loader.test.ts`

- `loadMcpTools()` registers `mcp__mock__echo` when nothing is disabled.
- With `disabledTools: { mock: ['echo'] }` the tool is filtered out server-side (`tools.size === 0`).

## Result

All 18 MCP tests pass; full `tsc` build is clean.

## Frontend (slice 2)

- `packages/web/src/components/SettingsPanel.tsx` MCP tab: template picker (Manual / Filesystem / GitHub / Custom stdio), draft + per-server connection test with structured status badges, per-tool enable/disable toggles.
- `packages/web/src/api.ts`: `mcpTemplates` / `mcpTestDraft` / `mcpTestServer` / `mcpToggleTool`; `mcpList` returns `disabledTools`.
- `npm --workspace neo-web run build` is clean for these files (only a pre-existing `MermaidBlock.tsx` mermaid-types error remains, unrelated).

## Not Covered (follow-up)

- Route-level integration tests for `mcp-config.ts` (helper logic exercised indirectly).
- Browser smoke test of the connector UI.
- Encrypted connector secret storage (env values currently saved to `mcp.json`).