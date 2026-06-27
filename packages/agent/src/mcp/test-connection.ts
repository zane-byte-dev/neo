/**
 * src/mcp/test-connection.ts — Structured "test connection" for stdio MCP
 * servers, used by the connector UI to give actionable failure feedback
 * instead of a generic error.
 *
 * It runs the real handshake (spawn → initialize → tools/list) under a short
 * timeout, then maps any failure to a stable `ConnectionErrorCode` the route /
 * UI can branch on. Cheap, deterministic checks (missing cwd, empty secret)
 * run before spawning so common misconfigurations are reported instantly.
 */

import { stat } from 'node:fs/promises';
import { StdioMcpClient } from './stdio-client.js';
import type { ExpandedServerConfig } from './connector-templates.js';

export type ConnectionErrorCode =
    | 'ok'
    | 'missing_secret'
    | 'cwd_not_found'
    | 'command_not_found'
    | 'process_exited'
    | 'timeout'
    | 'invalid_rpc'
    | 'no_tools'
    | 'unknown';

export interface ConnectionTestResult {
    ok: boolean;
    code: ConnectionErrorCode;
    message: string;
    toolCount?: number;
    tools?: Array<{ name: string; description?: string }>;
}

const SUGGESTION: Record<ConnectionErrorCode, string> = {
    ok: '连接成功。',
    missing_secret: '必填的密钥 / token 为空，请先填写凭据再测试。',
    cwd_not_found: '工作目录不存在，请检查 cwd 路径。',
    command_not_found: '找不到命令，请确认已安装对应包或命令在 PATH 中（如 npx）。',
    process_exited: 'MCP server 进程异常退出，请检查参数与日志。',
    timeout: '连接超时，server 可能启动缓慢或未按 MCP 协议响应。',
    invalid_rpc: 'server 返回的不是合法的 JSON-RPC，请确认它是 MCP server。',
    no_tools: '连接成功但未暴露任何工具，请检查 server 配置。',
    unknown: '未知错误，请查看后端日志获取详情。',
};

/**
 * Map a thrown error / message to a stable connection error code. Pure — no
 * spawning — so it is unit-testable in isolation.
 */
export function classifyConnectionError(err: unknown): ConnectionErrorCode {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (/enoent|not found|failed to spawn|spawn .* enoent/.test(msg)) return 'command_not_found';
    if (/timed out|timeout/.test(msg)) return 'timeout';
    if (/exited|exit code|killed|sigterm|sigkill/.test(msg)) return 'process_exited';
    if (/invalid json|parse|json-rpc|unexpected token/.test(msg)) return 'invalid_rpc';
    return 'unknown';
}

function result(code: ConnectionErrorCode, extra?: Partial<ConnectionTestResult>): ConnectionTestResult {
    return { ok: code === 'ok', code, message: SUGGESTION[code], ...extra };
}

export interface TestConnectionOptions {
    /** Handshake timeout in ms (default 12s). */
    timeoutMs?: number;
}

/**
 * Test an stdio MCP server config and return a structured result.
 * Always tears the spawned client down before returning.
 */
export async function testMcpConnection(
    config: ExpandedServerConfig,
    opts: TestConnectionOptions = {},
): Promise<ConnectionTestResult> {
    const command = (config.command ?? '').trim();
    if (!command) return result('command_not_found', { message: '命令为空，请填写 command。' });

    // Cheap pre-checks before spawning.
    if (config.cwd) {
        try {
            const s = await stat(config.cwd);
            if (!s.isDirectory()) return result('cwd_not_found');
        } catch {
            return result('cwd_not_found');
        }
    }
    const emptyEnvKey = Object.entries(config.env ?? {}).find(([, v]) => !String(v).trim());
    if (emptyEnvKey) {
        return result('missing_secret', { message: `环境变量 ${emptyEnvKey[0]} 为空，请填写后再测试。` });
    }

    const client = new StdioMcpClient({
        command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        timeoutMs: opts.timeoutMs ?? 12_000,
    });

    try {
        await client.start();
        const tools = await client.listTools();
        if (tools.length === 0) return result('no_tools', { toolCount: 0, tools: [] });
        return result('ok', {
            toolCount: tools.length,
            tools: tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })),
        });
    } catch (err) {
        const code = classifyConnectionError(err);
        const detail = err instanceof Error ? err.message : String(err);
        return result(code, { message: `${SUGGESTION[code]}（${detail}）` });
    } finally {
        client.stop();
    }
}
