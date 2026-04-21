/**
 * stdio-client.ts — Minimal MCP (Model Context Protocol) client over stdio.
 *
 * Spawns a server as a child process, speaks the MCP JSON-RPC 2.0 wire format
 * (newline-delimited JSON), and exposes `listTools()` + `callTool()`.
 *
 * This implements only the subset needed to surface remote tools to the agent
 * (initialize → tools/list → tools/call). Notifications and advanced features
 * (resources, prompts, sampling) are intentionally out of scope.
 *
 * References:
 *   https://modelcontextprotocol.io/specification/
 *   https://spec.modelcontextprotocol.io/specification/basic/transports/
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { log } from '../utils/logger.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'neo', version: '2.0.0' };
const DEFAULT_TIMEOUT_MS = 30_000;

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDef {
    name: string;
    description?: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, { type: string; description?: string }>;
        required?: string[];
    };
}

export interface McpContentBlock {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
}

export interface McpCallResult {
    content?: McpContentBlock[];
    isError?: boolean;
}

export interface StdioClientOptions {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    /** Per-request timeout in ms. Default 30s. */
    timeoutMs?: number;
}

export class StdioMcpClient {
    private child: ChildProcessWithoutNullStreams | null = null;
    private nextId = 1;
    private buffer = '';
    private pending = new Map<number, {
        resolve: (v: unknown) => void;
        reject: (err: Error) => void;
        timer: NodeJS.Timeout;
    }>();
    private readonly timeoutMs: number;

    constructor(private readonly opts: StdioClientOptions) {
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async start(): Promise<void> {
        if (this.child) return;
        const { command, args = [], env, cwd } = this.opts;
        this.child = spawn(command, args, {
            cwd,
            env: env ? { ...process.env, ...env } : process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.child.stdout.setEncoding('utf8');
        this.child.stderr.setEncoding('utf8');

        this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
        this.child.stderr.on('data', (chunk: string) => {
            // Servers commonly log to stderr — keep at debug to avoid noise.
            log.debug('mcp', `[${command}] stderr`, { chunk: chunk.slice(0, 400) });
        });
        this.child.on('exit', (code, signal) => {
            log.info('mcp', `[${command}] exited`, { code, signal });
            for (const [, p] of this.pending) {
                clearTimeout(p.timer);
                p.reject(new Error(`MCP server "${command}" exited (code=${code ?? 'null'})`));
            }
            this.pending.clear();
            this.child = null;
        });
        this.child.on('error', (err) => {
            log.error('mcp', `[${command}] spawn error`, { error: err.message });
        });

        await this.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
        });
        // Per spec, send `notifications/initialized` — fire-and-forget.
        this.sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }

    stop(): void {
        if (!this.child) return;
        try { this.child.kill(); } catch { /* ignore */ }
        this.child = null;
    }

    async listTools(): Promise<McpToolDef[]> {
        const result = (await this.request('tools/list')) as { tools?: McpToolDef[] };
        return result.tools ?? [];
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
        return (await this.request('tools/call', { name, arguments: args })) as McpCallResult;
    }

    private request(method: string, params?: unknown): Promise<unknown> {
        if (!this.child) throw new Error('MCP client not started');
        const id = this.nextId++;
        const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP request "${method}" timed out after ${this.timeoutMs}ms`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.sendRaw(payload);
        });
    }

    private sendRaw(msg: object): void {
        if (!this.child) return;
        try {
            this.child.stdin.write(JSON.stringify(msg) + '\n');
        } catch (err) {
            log.error('mcp', 'stdin write failed', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private onStdout(chunk: string): void {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line) as JsonRpcResponse;
                if (typeof msg.id !== 'number') continue; // ignore notifications
                const waiter = this.pending.get(msg.id);
                if (!waiter) continue;
                this.pending.delete(msg.id);
                clearTimeout(waiter.timer);
                if (msg.error) {
                    waiter.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
                } else {
                    waiter.resolve(msg.result);
                }
            } catch (err) {
                log.warn('mcp', 'failed to parse server message', {
                    line: line.slice(0, 200),
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
}
