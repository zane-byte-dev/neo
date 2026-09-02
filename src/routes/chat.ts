import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type Router from '@koa/router';
import { runAgentTurn } from '../services/agent-runner.js';
import { calcUser } from '../services/user-service.js';
import { sessionGet, sessionGetByNotebook, sessionCreate, sessionPatch } from '../services/chat-service.js';
import { MAX_INPUT_LENGTH } from '../config.js';
import { createSSEResponse } from '../utils/sse.js';
import { createConfirm } from '../utils/pending-confirm.js';
import { newRunId } from '../runtime/store.js';
import { listRunEvents } from '../runtime/events.js';
import { pruneTextChunkEventsSafe } from '../runtime/executor.js';
import type { RunEvent } from '../runtime/types.js';
import { log } from '../utils/logger.js';

const MODULE = 'ChatRoute';
const EVENT_POLL_MS = 25;
const TERMINAL_GRACE_MS = 300;

interface EventBridgeState {
    cursor: number;
    terminalSent: boolean;
    pendingToolResults: Map<string, { resultId?: string; truncated?: boolean }>;
}

function toolResultKey(toolName: string | undefined, resultId: string | undefined): string {
    return resultId ? `id:${resultId}` : `tool:${toolName ?? 'unknown'}`;
}

function mapRunEventToSse(
    event: RunEvent,
    state: EventBridgeState,
): Record<string, unknown> | null {
    switch (event.type) {
        case 'llm_chunk': {
            const { chunkType, text, toolName, resultId, truncated } = event.payload;
            if (chunkType === 'text' || chunkType === 'thought') {
                return text !== undefined ? { type: chunkType, text } : null;
            }
            if (chunkType === 'tool_result') {
                state.pendingToolResults.set(toolResultKey(toolName, resultId), { resultId, truncated });
            }
            return null;
        }
        case 'tool_call_started':
            return {
                type: 'tool_call',
                toolName: event.payload.toolName,
                ...(event.payload.args !== undefined && { args: event.payload.args }),
            };
        case 'tool_call_finished': {
            const key = toolResultKey(event.payload.toolName, event.payload.resultId);
            const pending = state.pendingToolResults.get(key);
            state.pendingToolResults.delete(key);
            return {
                type: 'tool_result',
                toolName: event.payload.toolName,
                ...(event.payload.resultPreview !== undefined && { result: event.payload.resultPreview }),
                ...((pending?.resultId ?? event.payload.resultId) !== undefined && { resultId: pending?.resultId ?? event.payload.resultId }),
                ...(pending?.truncated !== undefined && { truncated: pending.truncated }),
            };
        }
        case 'todo_updated':
            return { type: 'todo_update', todos: event.payload.todos };
        case 'artifact_created':
            if (event.payload.artifact.kind === 'image' && event.payload.artifact.url) {
                return {
                    type: 'image',
                    url: event.payload.artifact.url,
                    ...(event.payload.artifact.title !== undefined && { caption: event.payload.artifact.title }),
                };
            }
            if (event.payload.artifact.kind === 'video' && event.payload.artifact.url) {
                return { type: 'video', url: event.payload.artifact.url };
            }
            return null;
        case 'confirm_requested':
            return {
                type: 'tool_confirm',
                confirmId: event.payload.actionId,
                runId: event.runId,
                actionId: event.payload.actionId,
                ...(event.payload.toolName !== undefined && { toolName: event.payload.toolName }),
                ...(event.payload.args !== undefined && { args: event.payload.args }),
            };
        case 'confirm_resolved':
            return {
                type: 'confirm_resolved',
                confirmId: event.payload.actionId,
                runId: event.runId,
                actionId: event.payload.actionId,
                confirmStatus: event.payload.status,
                ...(event.payload.approvalScope !== undefined && { approvalScope: event.payload.approvalScope }),
            };
        case 'notebook_citations':
            return { type: 'citations', citations: event.payload.citations };
        case 'run_completed':
            state.terminalSent = true;
            return { type: 'done' };
        case 'run_failed':
            state.terminalSent = true;
            return { type: 'error', text: event.payload.error.message };
        default:
            return null;
    }
}

async function waitForSignalOrTimeout(signal: AbortSignal, ms: number): Promise<void> {
    if (signal.aborted || ms <= 0) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done(): void {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done, { once: true });
    });
}

async function bridgeRunEvents(
    workDir: string,
    runId: string,
    send: (data: unknown) => void,
    signal: AbortSignal,
    state: EventBridgeState,
): Promise<void> {
    while (!signal.aborted && !state.terminalSent) {
        try {
            const events = await listRunEvents(workDir, runId, {
                afterIndex: state.cursor,
                limit: 100,
            });
            if (events.length > 0) {
                for (const event of events) {
                    state.cursor = event.index;
                    const chunk = mapRunEventToSse(event, state);
                    if (chunk) send({ ...chunk, cursor: event.index });
                    if (state.terminalSent) return;
                }
                continue;
            }
        } catch (err: unknown) {
            log.warn(MODULE, 'bridgeRunEvents failed', {
                runId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        await waitForSignalOrTimeout(signal, EVENT_POLL_MS);
    }
}

async function waitForBridgeTerminal(
    bridgePromise: Promise<void>,
    signal: AbortSignal,
    state: EventBridgeState,
): Promise<void> {
    if (state.terminalSent || signal.aborted) return;
    await Promise.race([
        bridgePromise,
        waitForSignalOrTimeout(signal, TERMINAL_GRACE_MS),
    ]);
}

export function chatRoute(router: Router): void {
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
        let sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : undefined;
        const notebookId = typeof body.notebookId === 'string' && body.notebookId.trim() ? body.notebookId.trim() : undefined;
        const rawSourceIds = Array.isArray(body.sourceIds)
            ? (body.sourceIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
            : undefined;
        const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((v): v is string => typeof v === 'string' && v.startsWith('data:image/')) : undefined;
        // Document attachments: array of { filename, text } extracted on the client via /api/upload
        const documents = Array.isArray(body.documents)
            ? (body.documents as unknown[]).filter((v): v is { filename: string; text: string } =>
                typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).filename === 'string' && typeof (v as Record<string, unknown>).text === 'string')
            : undefined;
        const confirmDangerous = body.confirmDangerous === true;
        if (!message && (!images || images.length === 0) && (!documents || documents.length === 0)) {
            ctx.status = 400;
            ctx.body = { error: 'message, images, or documents required' };
            return;
        }
        if (message.length > MAX_INPUT_LENGTH) {
            ctx.status = 400;
            ctx.body = { error: `message too long (max ${MAX_INPUT_LENGTH} chars)` };
            return;
        }

        const userId = ctx.state.userId;

        // Notebook mode: resolve / create the implicit notebook session before running.
        if (notebookId) {
            let nbSession = await sessionGetByNotebook(userId, notebookId);
            if (!nbSession) {
                nbSession = await sessionCreate(userId, undefined, {
                    mode: 'notebook',
                    notebookId,
                    title: `Notebook: ${notebookId}`,
                    ...(rawSourceIds && rawSourceIds.length > 0 ? { sourceIds: rawSourceIds } : {}),
                });
            } else if (rawSourceIds !== undefined) {
                // Sync latest source selection onto the bound session.
                await sessionPatch(nbSession.id, userId, { source_ids: rawSourceIds });
            }
            sessionId = nbSession.id;
        } else if (sessionId && rawSourceIds !== undefined) {
            // Allow callers to update sourceIds for an existing notebook-mode session.
            const existing = await sessionGet(sessionId, userId);
            if (existing?.mode === 'notebook') {
                await sessionPatch(sessionId, userId, { source_ids: rawSourceIds });
            }
        }

        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }

        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir ?? userCtx.workDir;

        const sse = createSSEResponse(ctx);

        // Hoist runId so the finally block can prune events even on failure.
        let runId: string | undefined;

        try {
            // Build message with document context if present
            let effectiveMessage = message;
            if (documents?.length) {
                const docContext = documents.map((d) =>
                    `[Attached File: ${d.filename}]\n${d.text}`
                ).join('\n\n---\n\n');
                effectiveMessage = effectiveMessage
                    ? `${effectiveMessage}\n\n---\n\n${docContext}`
                    : docContext;
            }

            // Pre-allocate a runId so the client receives it on the
            // first SSE frame and can later subscribe to events / cancel
            // the run via the /api/runs API.
            runId = newRunId();
            // Notify client of the (possibly auto-resolved notebook) session id.
            if (notebookId) sse.send({ type: 'session', sessionId });
            sse.send({ type: 'run', runId });

            const bridgeState: EventBridgeState = {
                cursor: -1,
                terminalSent: false,
                pendingToolResults: new Map(),
            };
            const bridgePromise = bridgeRunEvents(
                stateDir,
                runId,
                sse.send,
                sse.signal,
                bridgeState,
            );

            await runAgentTurn({
                userId,
                sessionId,
                runId,
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                message: effectiveMessage,
                model,
                images: images?.length ? images : undefined,
                confirmCallback: confirmDangerous
                    ? async ({ toolName, args }) => {
                        const { confirmId, promise } = createConfirm(userId, {
                            runId,
                            workDir: stateDir,
                            request: { toolName, args },
                        });
                        return promise;
                    }
                    : undefined,
                onImage: async (data, mimeType, caption) => {
                    const ext = mimeType.includes('png') ? 'png' : 'jpg';
                    const filename = `gen_${Date.now()}.${ext}`;
                    const dir = join(stateDir, 'projects', sessionId);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(join(dir, filename), Buffer.from(data, 'base64'));
                    const url = `/api/assets/${sessionId}/${filename}`;
                    return {
                        path: filename,
                        url,
                        mimeType,
                        ...(caption ? { title: caption } : {}),
                    };
                },
                onVideo: async (url) => ({ url }),
            });

            await waitForBridgeTerminal(bridgePromise, sse.signal, bridgeState);
            if (!bridgeState.terminalSent && !sse.signal.aborted) {
                sse.send({ type: 'done' });
            }
        } catch (err: unknown) {
            if (!(err instanceof Error && err.name === 'AbortError')) {
                const text = err instanceof Error ? err.message : String(err);
                if (!sse.signal.aborted) {
                    sse.send({ type: 'error', text });
                }
            }
        } finally {
            // Prune high-volume streaming events regardless of success or failure.
            if (runId) await pruneTextChunkEventsSafe(stateDir, runId);
            sse.close();
        }
    });
}


