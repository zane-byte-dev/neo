import type Router from '@koa/router';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calcUser, invalidateUserCache } from '@neo/agent/services/user-service.js';
import { parseJsonOr } from '@neo/agent/utils/json.js';
import { listConnectorTemplates, expandTemplate, type ExpandedServerConfig } from '@neo/agent/mcp/connector-templates.js';
import { testMcpConnection } from '@neo/agent/mcp/test-connection.js';

interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

interface McpConfigFile {
    mcpServers?: Record<string, McpServerConfig>;
    disabledTools?: Record<string, string[]>;
}

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

async function readConfig(workDir: string): Promise<McpConfigFile> {
    try {
        return parseJsonOr<McpConfigFile>(await readFile(join(workDir, 'mcp.json'), 'utf8'), {});
    } catch {
        return {};
    }
}

async function writeConfig(workDir: string, config: McpConfigFile): Promise<void> {
    await mkdir(workDir, { recursive: true });
    const out: McpConfigFile = { mcpServers: config.mcpServers ?? {} };
    if (config.disabledTools && Object.keys(config.disabledTools).length > 0) {
        out.disabledTools = config.disabledTools;
    }
    await writeFile(join(workDir, 'mcp.json'), JSON.stringify(out, null, 2), 'utf8');
}

function normalizeServer(value: unknown): McpServerConfig | null {
    const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const command = typeof raw.command === 'string' ? raw.command.trim() : '';
    if (!command) return null;
    const args = Array.isArray(raw.args)
        ? raw.args.filter((v): v is string => typeof v === 'string')
        : [];
    const env = typeof raw.env === 'object' && raw.env !== null && !Array.isArray(raw.env)
        ? Object.fromEntries(Object.entries(raw.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
    const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() ? raw.cwd.trim() : undefined;
    return {
        command,
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(cwd ? { cwd } : {}),
    };
}

/**
 * Resolve a server config from a request body that is either a raw server
 * config (`{ command, args, env, cwd }`) or a template request
 * (`{ templateId, inputs }`). Returns `{ error }` (with optional `missing`)
 * on validation failure.
 */
function resolveServerConfig(
    body: unknown,
): { config: ExpandedServerConfig } | { error: string; missing?: string[] } {
    const raw = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    if (typeof raw.templateId === 'string') {
        const inputs = typeof raw.inputs === 'object' && raw.inputs !== null
            ? raw.inputs as Record<string, string>
            : {};
        const expanded = expandTemplate(raw.templateId, inputs);
        if (expanded.unknownTemplate) return { error: `Unknown template: ${raw.templateId}` };
        if (expanded.missing.length > 0) {
            return { error: 'Missing required fields', missing: expanded.missing };
        }
        return { config: expanded.config! };
    }
    const server = normalizeServer(body);
    if (!server) return { error: 'command is required' };
    return { config: server };
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;


export function mcpConfigRoute(router: Router): void {
    router.get('/api/mcp', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        ctx.body = { servers: config.mcpServers ?? {}, disabledTools: config.disabledTools ?? {} };
    });

    // Built-in connector templates for no-JSON creation.
    router.get('/api/mcp/templates', (ctx) => {
        ctx.body = { templates: listConnectorTemplates() };
    });

    // Test an arbitrary draft config (raw server config or { templateId, inputs })
    // before saving it.
    router.post('/api/mcp/test', async (ctx) => {
        const resolved = resolveServerConfig(ctx.request.body);
        if ('error' in resolved) {
            ctx.status = 400;
            ctx.body = resolved;
            return;
        }
        const result = await testMcpConnection(resolved.config);
        // Echo the resolved config so the UI can save a template-expanded server
        // without re-implementing template expansion on the client.
        ctx.body = { ...result, config: resolved.config };
    });

    // Test an already-saved server by name.
    router.post('/api/mcp/:name/test', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        const server = config.mcpServers?.[name];
        if (!server) {
            ctx.status = 404;
            ctx.body = { error: 'Server not found' };
            return;
        }
        ctx.body = await testMcpConnection(server);
    });

    router.put('/api/mcp/:name', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        if (!SERVER_NAME_PATTERN.test(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid server name' };
            return;
        }
        const server = normalizeServer(ctx.request.body);
        if (!server) {
            ctx.status = 400;
            ctx.body = { error: 'command is required' };
            return;
        }
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        config.mcpServers = { ...(config.mcpServers ?? {}), [name]: server };
        await writeConfig(workDir, config);
        invalidateUserCache(userId);
        ctx.body = { ok: true, name, server };
    });

    router.delete('/api/mcp/:name', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        if (config.mcpServers) delete config.mcpServers[name];
        if (config.disabledTools) delete config.disabledTools[name];
        await writeConfig(workDir, config);
        invalidateUserCache(userId);
        ctx.body = { ok: true };
    });

    // Enable / disable a single tool of a server. Enforced server-side: disabled
    // tools are skipped by the MCP loader and never reach the agent registry.
    router.patch('/api/mcp/:name/tools/:tool', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const toolName = ctx.params.tool ?? '';
        if (!SERVER_NAME_PATTERN.test(name) || !TOOL_NAME_PATTERN.test(toolName)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid server or tool name' };
            return;
        }
        const body = typeof ctx.request.body === 'object' && ctx.request.body !== null
            ? ctx.request.body as Record<string, unknown>
            : {};
        if (typeof body.enabled !== 'boolean') {
            ctx.status = 400;
            ctx.body = { error: 'enabled (boolean) is required' };
            return;
        }
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        if (!config.mcpServers?.[name]) {
            ctx.status = 404;
            ctx.body = { error: 'Server not found' };
            return;
        }
        const disabledTools = { ...(config.disabledTools ?? {}) };
        const current = new Set(disabledTools[name] ?? []);
        if (body.enabled) current.delete(toolName);
        else current.add(toolName);
        if (current.size > 0) disabledTools[name] = [...current];
        else delete disabledTools[name];
        config.disabledTools = disabledTools;
        await writeConfig(workDir, config);
        invalidateUserCache(userId);
        ctx.body = { ok: true, name, tool: toolName, enabled: body.enabled };
    });
}
