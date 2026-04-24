/**
 * loader.ts — Load MCP server definitions from the user's workspace and
 * surface their remote tools as Neo Tool objects.
 *
 * Config location: {workDir}/mcp.json
 *
 * Shape (matches the common `mcpServers` convention used by Claude / Cursor):
 *
 *   {
 *     "mcpServers": {
 *       "my-server": {
 *         "command": "npx",
 *         "args": ["-y", "@some/mcp-server"],
 *         "env": { "API_KEY": "..." }
 *       }
 *     }
 *   }
 *
 * All MCP tools are exposed under the prefix `mcp__<server>__<tool>` so
 * names never collide with built-ins. Failures during spawn/list are logged
 * and the server is skipped — they never break user tool loading.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseJsonOr } from '../utils/json.js';
import { log } from '../utils/logger.js';
import { StdioMcpClient, type McpToolDef, type McpCallResult } from './stdio-client.js';
import type { Tool, FunctionDeclaration } from '../llm/types.js';

const MODULE = 'mcp';

interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

interface McpConfigFile {
    mcpServers?: Record<string, McpServerConfig>;
}

/** Sanitise tool name for use inside our registry (snake/alphanum). */
function mcpToolName(server: string, tool: string): string {
    const clean = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');
    return `mcp__${clean(server)}__${clean(tool)}`;
}

function mcpResultToText(res: McpCallResult): string {
    if (res.isError) {
        const text = (res.content ?? []).map((b) => b.text ?? '').join('\n').trim();
        return `[Error] ${text || 'MCP server reported an error'}`;
    }
    const text = (res.content ?? [])
        .map((b) => (b.type === 'text' ? b.text ?? '' : `[${b.type} content]`))
        .join('\n')
        .trim();
    return text || '(no content)';
}

function buildDeclaration(prefixedName: string, def: McpToolDef): FunctionDeclaration {
    const schema = def.inputSchema ?? { type: 'object', properties: {} };
    return {
        name: prefixedName,
        description: def.description ?? `MCP tool ${def.name}`,
        parameters: {
            type: schema.type ?? 'object',
            properties: (schema.properties ?? {}) as FunctionDeclaration['parameters']['properties'],
            required: schema.required,
        },
    };
}

/**
 * Read `{workDir}/mcp.json`, spawn each server, and return a map of
 * prefixed-tool-name → Tool. Returns an empty map when no config exists
 * or no servers connect successfully.
 *
 * The caller is responsible for calling `shutdownAll()` on teardown if
 * long-running; for a per-request lifecycle, servers persist in the
 * cache keyed by workDir (see `calcUser`).
 */
export async function loadMcpTools(workDir: string): Promise<Map<string, Tool>> {
    const tools = new Map<string, Tool>();
    const configPath = join(workDir, 'mcp.json');

    let config: McpConfigFile;
    try {
        const raw = await readFile(configPath, 'utf8');
        config = parseJsonOr<McpConfigFile>(raw, {});
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') {
            log.warn(MODULE, 'failed to read mcp.json', { workDir, error: e.message });
        }
        return tools;
    }

    const servers = config.mcpServers ?? {};
    for (const [serverName, cfg] of Object.entries(servers)) {
        const client = new StdioMcpClient({
            command: cfg.command,
            args: cfg.args,
            env: cfg.env,
            cwd: cfg.cwd ?? workDir,
        });
        try {
            await client.start();
            const defs = await client.listTools();
            log.info(MODULE, `connected to "${serverName}" — ${defs.length} tools`);
            for (const def of defs) {
                const fullName = mcpToolName(serverName, def.name);
                tools.set(fullName, {
                    declaration: buildDeclaration(fullName, def),
                    meta: {
                        category: 'utility',
                        version: '1.0.0',
                        // Remote tools can do anything; require user confirmation when the hook is set.
                        permission: 'dangerous',
                    },
                    handler: async (args) => {
                        try {
                            const res = await client.callTool(def.name, args);
                            return mcpResultToText(res);
                        } catch (callErr) {
                            const msg = callErr instanceof Error ? callErr.message : String(callErr);
                            return `[Error] MCP ${serverName}.${def.name} failed: ${msg}`;
                        }
                    },
                });
            }
        } catch (err) {
            log.error(MODULE, `failed to connect to "${serverName}"`, {
                error: err instanceof Error ? err.message : String(err),
            });
            client.stop();
        }
    }

    return tools;
}
