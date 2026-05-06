import type Router from '@koa/router';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calcUser, invalidateUserCache } from '../services/user-service.js';
import { parseJsonOr } from '../utils/json.js';

interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

interface McpConfigFile {
    mcpServers?: Record<string, McpServerConfig>;
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
    await writeFile(join(workDir, 'mcp.json'), JSON.stringify({ mcpServers: config.mcpServers ?? {} }, null, 2), 'utf8');
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

export function mcpConfigRoute(router: Router): void {
    router.get('/api/mcp', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const config = await readConfig(workDir);
        ctx.body = { servers: config.mcpServers ?? {} };
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
        await writeConfig(workDir, config);
        invalidateUserCache(userId);
        ctx.body = { ok: true };
    });
}
