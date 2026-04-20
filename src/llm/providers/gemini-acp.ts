/**
 * src/llm/providers/gemini-acp.ts — Gemini CLI ACP provider.
 *
 * Spawns a `gemini --acp` child process and communicates via the ACP protocol
 * (JSON-RPC over NDJSON stdio). This lets Neo use the Gemini model through
 * Gemini CLI's OAuth-based quota (Google One AI Premium) instead of an API key.
 *
 * The provider is used for **text generation only** — Neo's own tool system
 * handles tool calls, so we never register tools with Gemini CLI.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
    ClientSideConnection,
    ndJsonStream,
    PROTOCOL_VERSION,
    type SessionNotification,
    type RequestPermissionRequest,
    type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { GEMINI_CLI_PATH } from '../../config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AcpState {
    child: ChildProcess;
    conn: ClientSideConnection;
    sessionId: string;
}

export type AcpChunkCallback = (text: string) => void;

// ── Singleton process manager ─────────────────────────────────────────────────

let state: AcpState | null = null;
let initialising: Promise<AcpState> | null = null;

/** Collected text chunks keyed by an opaque prompt-id. */
const pendingChunks = new Map<string, { texts: string[]; thoughts: string[] }>();

/** Monotonic counter to create prompt correlation ids. */
let promptSeq = 0;

/** Current prompt ID being processed — set around conn.prompt() calls. */
let currentPromptId: string | null = null;

/** Check whether the ACP backend is (or could be) available. */
export function isAcpAvailable(): boolean {
    return state !== null || initialising !== null;
}

/**
 * Try to start the ACP process eagerly at boot.
 * Non-blocking — failures are logged and silently ignored.
 */
export function tryStartAcp(): void {
    ensureAcp().catch((err) => {
        console.warn(`[GeminiACP] Failed to start: ${err instanceof Error ? err.message : err}`);
    });
}

/** Ensure the gemini --acp process is running and a session exists. */
async function ensureAcp(): Promise<AcpState> {
    if (state) return state;
    if (initialising) return initialising;

    initialising = (async () => {
        console.log('[GeminiACP] Spawning gemini --acp …');
        const child = spawn(GEMINI_CLI_PATH, ['--acp'], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env },
        });

        child.on('exit', (code) => {
            console.log(`[GeminiACP] Process exited (code=${code}). Will respawn on next request.`);
            state = null;
            initialising = null;
        });

        const stdout = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
        const stdin = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
        const stream = ndJsonStream(stdin, stdout);

        const conn = new ClientSideConnection(
            (_agent) => ({
                // Handle session update notifications — collect text chunks
                async sessionUpdate(params: SessionNotification): Promise<void> {
                    const update = params.update;
                    if (!currentPromptId) return;
                    const bucket = pendingChunks.get(currentPromptId);
                    if (!bucket) return;

                    if (update.sessionUpdate === 'agent_message_chunk') {
                        const content = update.content;
                        if (content.type === 'text' && 'text' in content) {
                            bucket.texts.push(content.text);
                        }
                    } else if (update.sessionUpdate === 'agent_thought_chunk') {
                        const content = update.content;
                        if (content.type === 'text' && 'text' in content) {
                            bucket.thoughts.push(content.text);
                        }
                    }
                    // Ignore tool_call, plan, etc. — Neo handles its own tools
                },

                // Auto-approve any permission requests (Gemini CLI may ask for file access etc.)
                async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
                    // Pick the first option (usually "Allow once") to auto-approve
                    const optionId = params.options?.[0]?.optionId ?? 'allow';
                    return {
                        outcome: {
                            outcome: 'selected' as const,
                            optionId,
                        },
                    };
                },
            }),
            stream,
        );

        // Initialize connection
        const initResp = await conn.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: { name: 'neo', version: '1.0.0' },
        });
        console.log(`[GeminiACP] Initialized. Agent: ${initResp.agentInfo?.name ?? 'unknown'}`);

        // Authenticate (use env-based auth — relies on existing gemini CLI login)
        if (initResp.authMethods?.length) {
            const method = initResp.authMethods[0];
            try {
                await conn.authenticate({ methodId: method.id });
                console.log(`[GeminiACP] Authenticated via ${method.id}`);
            } catch (e) {
                console.warn(`[GeminiACP] Auth warning: ${e instanceof Error ? e.message : e}`);
            }
        }

        // Create session
        const sessionResp = await conn.newSession({
            cwd: process.cwd(),
            mcpServers: [],
        });
        console.log(`[GeminiACP] Session created: ${sessionResp.sessionId}`);

        const s: AcpState = { child, conn, sessionId: sessionResp.sessionId };
        state = s;
        initialising = null;
        return s;
    })();

    return initialising;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a prompt to Gemini CLI via ACP and collect the full response text.
 */
export async function acpGenerate(prompt: string): Promise<string> {
    const s = await ensureAcp();
    const promptId = `p-${++promptSeq}`;

    pendingChunks.set(promptId, { texts: [], thoughts: [] });
    currentPromptId = promptId;

    try {
        await s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [{ type: 'text', text: prompt }],
        });
    } catch (err) {
        console.error('[GeminiACP] Prompt error:', err);
        throw err;
    } finally {
        currentPromptId = null;
    }

    const bucket = pendingChunks.get(promptId);
    pendingChunks.delete(promptId);
    return bucket?.texts.join('') ?? '';
}

/**
 * Send a prompt and stream text chunks back via callback.
 * Returns the full accumulated text.
 */
export async function acpStream(
    prompt: string,
    onTextChunk: AcpChunkCallback,
    onThoughtChunk?: AcpChunkCallback,
): Promise<string> {
    const s = await ensureAcp();
    const promptId = `p-${++promptSeq}`;

    pendingChunks.set(promptId, { texts: [], thoughts: [] });
    currentPromptId = promptId;

    let lastTextIdx = 0;
    let lastThoughtIdx = 0;

    // Poll interval to flush chunks to caller in near-real-time
    const interval = setInterval(() => {
        const bucket = pendingChunks.get(promptId);
        if (!bucket) return;
        while (lastThoughtIdx < bucket.thoughts.length) {
            onThoughtChunk?.(bucket.thoughts[lastThoughtIdx]);
            lastThoughtIdx++;
        }
        while (lastTextIdx < bucket.texts.length) {
            onTextChunk(bucket.texts[lastTextIdx]);
            lastTextIdx++;
        }
    }, 50);

    try {
        await s.conn.prompt({
            sessionId: s.sessionId,
            prompt: [{ type: 'text', text: prompt }],
        });
    } finally {
        clearInterval(interval);
        currentPromptId = null;
    }

    // Flush remaining chunks
    const bucket = pendingChunks.get(promptId);
    if (bucket) {
        while (lastThoughtIdx < bucket.thoughts.length) {
            onThoughtChunk?.(bucket.thoughts[lastThoughtIdx]);
            lastThoughtIdx++;
        }
        while (lastTextIdx < bucket.texts.length) {
            onTextChunk(bucket.texts[lastTextIdx]);
            lastTextIdx++;
        }
    }
    pendingChunks.delete(promptId);

    return bucket?.texts.join('') ?? '';
}

/** Shut down the ACP process if running. */
export function shutdownAcp(): void {
    if (state) {
        state.child.kill();
        state = null;
        initialising = null;
    }
}
