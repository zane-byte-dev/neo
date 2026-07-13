import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

function atmExecutable(): string {
    return process.env.ATM_EXECUTABLE ?? 'atm';
}

function workspaceRoot(): string {
    const root = process.env.ATM_WORKSPACE_ROOT;
    if (!root) throw new Error('ATM_WORKSPACE_ROOT is required');
    return root;
}

class AtmMcpClient {
    private child?: ReturnType<typeof spawn>;
    private nextId = 0;
    private stderr = '';
    private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
        await this.start();
        const response = await this.request('tools/call', { name, arguments: args }, signal) as {
            structuredContent?: unknown;
            isError?: boolean;
            content?: Array<{ text?: string }>;
        };
        if (response.isError) throw new Error(response.content?.[0]?.text ?? `ATM MCP tool ${name} failed`);
        return response.structuredContent;
    }

    async stop(): Promise<void> {
        const child = this.child;
        this.child = undefined;
        if (!child) return;
        child.stdin?.end();
        child.kill('SIGTERM');
        this.rejectAll(new Error('ATM MCP client stopped'));
    }

    private async start(): Promise<void> {
        if (this.child) return;
        const child = spawn(atmExecutable(), ['--workspace', workspaceRoot(), 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        this.stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-64 * 1024); });
        child.once('error', (error) => this.fail(new Error(`ATM MCP failed to start: ${error.message}`)));
        child.once('exit', (code, exitSignal) => this.fail(new Error(`ATM MCP exited (${exitSignal ?? code ?? 'unknown'}): ${this.stderr.trim()}`)));
        const lines = createInterface({ input: child.stdout! });
        lines.on('line', (line) => this.handleLine(line));
        await this.request('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'neo-pi-extension', version: '0.1.0' },
        });
        this.notify('notifications/initialized', {});
    }

    private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                this.pending.delete(id);
                void this.stop();
                reject(new DOMException('Aborted', 'AbortError'));
            };
            if (signal?.aborted) return onAbort();
            signal?.addEventListener('abort', onAbort, { once: true });
            this.pending.set(id, {
                resolve: (value) => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                reject: (error) => {
                    signal?.removeEventListener('abort', onAbort);
                    reject(error);
                },
            });
            this.write({ jsonrpc: '2.0', id, method, params });
        });
    }

    private notify(method: string, params: unknown): void {
        this.write({ jsonrpc: '2.0', method, params });
    }

    private write(message: unknown): void {
        if (!this.child?.stdin) throw new Error('ATM MCP process is not running');
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private handleLine(line: string): void {
        let message: { id?: unknown; result?: unknown; error?: { message?: string } };
        try {
            message = JSON.parse(line) as typeof message;
        } catch {
            this.fail(new Error(`ATM MCP emitted invalid JSON: ${line.slice(0, 500)}`));
            return;
        }
        if (typeof message.id !== 'number') return;
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message ?? 'ATM MCP request failed'));
        else request.resolve(message.result);
    }

    private fail(error: Error): void {
        this.child = undefined;
        this.rejectAll(error);
    }

    private rejectAll(error: Error): void {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }
}

const mcp = new AtmMcpClient();
const citationNumbers = new Map<string, number>();
const citationSources = new Map<number, { documentId: string; path?: string; lineStart?: number; lineEnd?: number; citation: number }>();
let nextCitation = 1;

function citationKey(value: Record<string, unknown>): string | undefined {
    const documentId = value.document_id ?? value.documentId;
    if (typeof documentId !== 'string') return undefined;
    const start = value.line_start ?? value.lineStart;
    const end = value.line_end ?? value.lineEnd ?? start;
    return `${documentId}#L${String(start ?? '')}-L${String(end ?? '')}`;
}

function citationFor(value: Record<string, unknown>): number | undefined {
    const key = citationKey(value);
    if (!key) return undefined;
    let citation = citationNumbers.get(key);
    if (!citation) {
        citation = nextCitation++;
        citationNumbers.set(key, citation);
    }
    return citation;
}

const knowledgeSearch = defineTool({
    name: 'knowledge_search',
    label: 'Search knowledge',
    description: 'Search the configured workspace Markdown knowledge and return citable line ranges.',
    parameters: Type.Object({
        query: Type.String({ description: 'Literal or semantic keyword query' }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    }),
    async execute(_id, params, signal) {
        const raw = await mcp.callTool('knowledge_search', { query: params.query, limit: params.limit ?? 8 }, signal);
        const data = Array.isArray(raw)
            ? raw.map((hit) => {
                const row = hit as Record<string, unknown>;
                const citation = citationFor(row);
                const documentId = row.document_id;
                if (citation && typeof documentId === 'string') {
                    citationSources.set(citation, {
                        documentId,
                        ...(typeof row.relative_path === 'string' ? { path: row.relative_path } : {}),
                        ...(typeof row.line_start === 'number' ? { lineStart: row.line_start } : {}),
                        ...(typeof row.line_end === 'number' ? { lineEnd: row.line_end } : {}),
                        citation,
                    });
                }
                return { ...row, ...(citation ? { citation: `【${citation}】` } : {}) };
            })
            : raw;
        return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    },
});

const knowledgeGet = defineTool({
    name: 'knowledge_get',
    label: 'Read knowledge',
    description: 'Read a workspace Markdown document by the document id returned from knowledge_search.',
    parameters: Type.Object({ documentId: Type.String() }),
    async execute(_id, params, signal) {
        const data = await mcp.callTool('knowledge_get', { documentId: params.documentId }, signal);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    },
});

const memoryRecall = defineTool({
    name: 'memory_recall',
    label: 'Recall memory',
    description: 'Recall shared facts and episodic memory, optionally restricted to a scope.',
    parameters: Type.Object({
        query: Type.Optional(Type.String()),
        scope: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    }),
    async execute(_id, params, signal) {
        const data = await mcp.callTool('memory_recall', {
            query: params.query,
            scope: params.scope,
            limit: params.limit ?? 8,
        }, signal);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    },
});

const memoryRemember = defineTool({
    name: 'memory_remember',
    label: 'Remember fact',
    description: 'Append a shared fact using the ATM versioned memory schema.',
    parameters: Type.Object({
        content: Type.String(),
        scope: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal) {
        const data = await mcp.callTool('memory_remember', {
            content: params.content,
            scope: params.scope ?? 'global',
            tags: params.tags,
        }, signal);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    },
});

const artifactSave = defineTool({
    name: 'artifact_save',
    label: 'Save artifact',
    description: 'Atomically save a Markdown artifact with provenance. Use this for the final durable deliverable.',
    parameters: Type.Object({
        title: Type.String(),
        markdown: Type.String(),
        runId: Type.Optional(Type.String()),
        sources: Type.Optional(Type.Array(Type.Object({
            documentId: Type.String(),
            path: Type.Optional(Type.String()),
            lineStart: Type.Optional(Type.Number()),
            lineEnd: Type.Optional(Type.Number()),
        }))),
    }),
    async execute(_id, params, signal) {
        const referenced = [...params.markdown.matchAll(/【(\d+)】/g)]
            .map((match) => Number(match[1]))
            .filter((citation, index, all) => citation > 0 && all.indexOf(citation) === index)
            .flatMap((citation) => {
                const source = citationSources.get(citation);
                return source ? [source] : [];
            });
        const sources = referenced.length > 0
            ? referenced
            : params.sources?.map((source) => ({
                ...source,
                citation: citationFor(source as unknown as Record<string, unknown>),
            }));
        const data = await mcp.callTool('artifact_save', {
            title: params.title,
            markdown: params.markdown,
            producer: 'pi',
            runId: params.runId,
            sources,
        }, signal);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data };
    },
});

export default function atmTools(pi: ExtensionAPI): void {
    pi.registerTool(knowledgeSearch);
    pi.registerTool(knowledgeGet);
    pi.registerTool(memoryRecall);
    pi.registerTool(memoryRemember);
    pi.registerTool(artifactSave);
    pi.on('session_start', () => {
        citationNumbers.clear();
        citationSources.clear();
        nextCitation = 1;
    });
    pi.registerCommand('atm-tools-status', {
        description: 'Verify that the Neo ATM MCP tools extension can query the configured workspace',
        handler: async (_args, ctx) => {
            const result = await mcp.callTool('knowledge_search', { query: 'ifs 视频专家', limit: 1 });
            const count = Array.isArray(result) ? result.length : 0;
            ctx.ui.notify(`ATM MCP ready for ${workspaceRoot()} (${count} probe result)`, 'info');
        },
    });
    pi.on('session_shutdown', async () => {
        await mcp.stop();
    });
}
