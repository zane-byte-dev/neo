/**
 * agent-runner.ts — Shared "one conversation turn" logic.
 *
 * Encapsulates the full lifecycle of a single user→assistant exchange:
 *   1. Load user runtime context (calcUser)
 *   2. Create or look up a runtime `run` (persistent, recoverable)
 *   3. Ensure a session exists, read history, save user message
 *   4. Run LLM (streaming) — every chunk / tool call / todo / artifact
 *      is mirrored to the run's append-only event log
 *   5. Save assistant message, finalise checkpoint + metrics
 *   6. Return the full response text
 *
 * Callers (HTTP route, Telegram bot, …) only supply IO-specific callbacks
 * and (optionally) a pre-allocated `runId` so they can subscribe to the
 * run from elsewhere.
 */

import { LLMClient } from '../llm/client.js';
import type { StreamChunk, ToolContext } from '../llm/types.js';
import { resolveSmartRoute } from '../llm/model-router.js';
import { calcUser } from './user-service.js';
import { messageAdd, messageList, sessionCreate, sessionGet } from './chat-service.js';
import { log } from '../utils/logger.js';
import { createRun, loadRun, newRunId } from '../runtime/store.js';
import {
    appendRunEventSafe,
    bumpRunMetrics,
    previewText,
    saveRunCheckpointSafe,
    startCancellationProbe,
    updateRunStatusSafe,
} from '../runtime/executor.js';
import type {
    JsonObject,
    RunEntrypoint,
    RunTriggerType,
    RunTodoItem,
} from '../runtime/types.js';

const MODULE = 'AgentRunner';

const llm = new LLMClient();

export interface AgentRunOptions {
    userId: string;
    sessionId: string;
    message: string;
    /** Override the default model (alias or full id) */
    model?: string;
    /** Base64 data-URL images attached by the user */
    images?: string[];
    /** Abort signal — caller can cancel mid-stream */
    signal?: AbortSignal;
    /** Called for every chunk from the LLM stream */
    onChunk?: (chunk: StreamChunk) => void;
    /** Called when the LLM produces an image */
    onImage?: (data: string, mimeType: string, caption?: string) => Promise<void>;
    /** Called when a video is generated */
    onVideo?: (url: string) => Promise<void>;
    /** Called when the todo list is updated */
    onTodo?: (todos: { id: number; title: string; status: string }[]) => void;
    /**
     * Confirmation hook for dangerous-tier tools. When set, the executor
     * will call it before running any such tool; returning false cancels
     * the call with a `[DENIED]` result.
     */
    confirmCallback?: (req: { toolName: string; args: Record<string, unknown> }) => Promise<boolean>;
    /**
     * Pre-allocated run id. When omitted a fresh run is created and
     * persisted under `{workDir}/.neo/runs/{runId}/`. Provide this
     * when the caller (e.g. HTTP route) needs to surface the runId
     * to a client before the turn starts.
     */
    runId?: string;
    /** Logical entrypoint of the run (default: `web-chat`). */
    entrypoint?: RunEntrypoint;
    /** Triggering event type (default: `user_message`). */
    triggerType?: RunTriggerType;
    /** Optional notebook id when the run originates from a notebook. */
    notebook?: string;
    /** Optional parent run id for nested / forked executions. */
    parentRunId?: string;
    /** Free-form metadata persisted on `run.json`. */
    metadata?: JsonObject;
    /**
     * Called once the runtime `run` has been created, before LLM work
     * starts. Useful for HTTP routes that want to surface the runId via
     * SSE on the first frame.
     */
    onRunCreated?: (runId: string) => void;
}

/**
 * Run one agent turn and return the full assistant response text.
 * Throws on unrecoverable error (AbortError is re-thrown as-is).
 */
export async function runAgentTurn(opts: AgentRunOptions): Promise<string> {
    const {
        userId, sessionId, message, model: rawModel, images, signal,
        onChunk, onImage, onVideo, onTodo, confirmCallback,
        entrypoint = 'web-chat',
        triggerType = 'user_message',
        notebook,
        parentRunId,
        metadata,
        onRunCreated,
    } = opts;

    const t0 = Date.now();

    const userCtx = await calcUser(userId);
    const workDir = userCtx.workDir;

    // ── Step 1: ensure a runtime run exists ──────────────────────────
    const runId = opts.runId ?? newRunId();
    const wantsCreate = !opts.runId || !(await loadRun(workDir, runId));
    if (wantsCreate) {
        try {
            await createRun(workDir, {
                id: runId,
                userId,
                entrypoint,
                triggerType,
                sessionId,
                ...(notebook !== undefined && { notebook }),
                ...(parentRunId !== undefined && { parentRunId }),
                request: {
                    message,
                    ...(rawModel !== undefined && { model: rawModel }),
                    ...(images?.length ? { imageCount: images.length } : {}),
                },
                ...(metadata !== undefined && { metadata }),
            });
            await appendRunEventSafe(workDir, runId, 'run_created', {
                status: 'queued',
                entrypoint,
                triggerType,
            });
        } catch (err: unknown) {
            // Persistence is best-effort. Log and proceed with the turn.
            log.warn(MODULE, 'createRun failed', {
                runId, userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    onRunCreated?.(runId);

    // Resolve the user's preferred default model when the caller did not
    // specify one (or explicitly asked for 'auto').
    const effectiveUserModel = rawModel && rawModel !== 'auto'
        ? rawModel
        : userCtx.preferences.defaultModel ?? rawModel;

    // Smart routing: resolve 'auto' or undefined to the best model
    const route = resolveSmartRoute({
        userModel: effectiveUserModel,
        hasTools: true,
        message,
    });
    const model = route.model;

    log.info(MODULE, 'Turn start', {
        userId,
        sessionId,
        runId,
        model,
        tier: route.tier,
        score: route.score,
        confidence: route.confidence,
        messageLen: message.length,
        preview: message.slice(0, 100),
    });

    await updateRunStatusSafe(workDir, runId, 'running');
    await appendRunEventSafe(workDir, runId, 'run_started', {
        startedAt: new Date().toISOString(),
    });
    await appendRunEventSafe(workDir, runId, 'route_resolved', {
        model,
        ...(route.tier !== undefined && { tier: route.tier }),
        ...(route.score !== undefined && { score: route.score }),
        ...(route.confidence !== undefined && { confidence: route.confidence }),
    });

    let session = await sessionGet(sessionId, userId);
    if (!session) session = await sessionCreate(userId, sessionId);

    const historyRows = await messageList(sessionId, userId);
    const history = historyRows.map((r) => ({
        role: r.role === 'assistant' || r.role === 'model' ? 'assistant' : 'user',
        content: r.content,
    }));

    await messageAdd(session.id, userId, 'user', message);
    await appendRunEventSafe(workDir, runId, 'user_message_saved', {
        role: 'user',
        sessionId: session.id,
        contentLength: message.length,
        ...(previewText(message) !== undefined && { contentPreview: previewText(message)! }),
    });

    const cancelProbe = startCancellationProbe(workDir, runId);
    const cancelController = new AbortController();
    const onCancel = () => cancelController.abort();
    if (signal) {
        if (signal.aborted) onCancel();
        else signal.addEventListener('abort', onCancel, { once: true });
    }
    const cancelPoll = setInterval(() => {
        if (cancelProbe.isCancelled()) {
            cancelController.abort();
            clearInterval(cancelPoll);
        }
    }, 500);
    if (typeof cancelPoll.unref === 'function') cancelPoll.unref();
    const effectiveSignal = cancelController.signal;

    // ── Wrap caller callbacks to also emit runtime events ─────────────
    let toolCallCount = 0;
    const toolStarts = new Map<string, number>(); // toolName → start ms

    const wrappedChunk = (chunk: StreamChunk) => {
        // Surface to caller first so existing UI behaviour is unchanged.
        onChunk?.(chunk);
        const text = (chunk as { text?: string }).text;
        const args = (chunk as { args?: Record<string, unknown> }).args;
        const toolName = (chunk as { toolName?: string }).toolName;
        const resultId = (chunk as { resultId?: string }).resultId;
        const truncated = (chunk as { truncated?: boolean }).truncated;
        void appendRunEventSafe(workDir, runId, 'llm_chunk', {
            chunkType: chunk.type,
            ...(text !== undefined && { text: previewText(text, 500) ?? text }),
            ...(toolName !== undefined && { toolName }),
            ...(args !== undefined && { args: args as JsonObject }),
            ...(resultId !== undefined && { resultId }),
            ...(truncated !== undefined && { truncated }),
        });
        if (chunk.type === 'tool_call') {
            toolCallCount += 1;
            toolStarts.set(`${toolName ?? 'tool'}:${toolCallCount}`, Date.now());
            void appendRunEventSafe(workDir, runId, 'tool_call_started', {
                toolName: toolName ?? 'unknown',
                ...(args !== undefined && { args: args as JsonObject }),
            });
        } else if (chunk.type === 'tool_result') {
            // Match the most recent unfinished start for this tool.
            let startMs: number | undefined;
            for (const [k, v] of toolStarts) {
                if (k.startsWith(`${toolName}:`)) {
                    startMs = v;
                    toolStarts.delete(k);
                }
            }
            const durationMs = startMs ? Date.now() - startMs : undefined;
            const previewSrc = (chunk as { result?: string }).result;
            void appendRunEventSafe(workDir, runId, 'tool_call_finished', {
                toolName: toolName ?? 'unknown',
                outcome: 'success',
                ...(durationMs !== undefined && { durationMs }),
                ...(resultId !== undefined && { resultId }),
                ...(previewText(previewSrc) !== undefined && {
                    resultPreview: previewText(previewSrc)!,
                }),
            });
        }
    };

    const wrappedTodo = onTodo
        ? (todos: { id: number; title: string; status: string }[]) => {
            onTodo(todos);
            const normalised: RunTodoItem[] = todos.map((t) => ({
                id: t.id,
                title: t.title,
                status: (t.status === 'in-progress' || t.status === 'completed'
                    ? t.status
                    : 'not-started') as RunTodoItem['status'],
            }));
            void appendRunEventSafe(workDir, runId, 'todo_updated', { todos: normalised });
        }
        : undefined;

    const wrappedImage = onImage
        ? async (data: string, mimeType: string, caption?: string) => {
            await onImage(data, mimeType, caption);
            void appendRunEventSafe(workDir, runId, 'artifact_created', {
                artifact: {
                    id: `art_${Date.now().toString(36)}`,
                    runId,
                    kind: 'image',
                    createdAt: new Date().toISOString(),
                    mimeType,
                    ...(caption !== undefined && { title: caption }),
                },
            });
        }
        : undefined;

    const wrappedVideo = onVideo
        ? async (url: string) => {
            await onVideo(url);
            void appendRunEventSafe(workDir, runId, 'artifact_created', {
                artifact: {
                    id: `art_${Date.now().toString(36)}`,
                    runId,
                    kind: 'video',
                    createdAt: new Date().toISOString(),
                    url,
                },
            });
        }
        : undefined;

    const toolContext: ToolContext = {
        userId,
        sessionId,
        workDir: userCtx.workDir,
        systemInstruction: userCtx.systemInstruction,
        signal: effectiveSignal,
        skillRegistry: userCtx.skillRegistry,
        userTools: userCtx.userTools,
        ...(wrappedImage && { imageCallback: wrappedImage }),
        ...(wrappedVideo && { videoCallback: wrappedVideo }),
        ...(wrappedTodo && { todoCallback: wrappedTodo }),
        ...(confirmCallback && { confirmCallback }),
    };

    let fullResponse = '';
    let lastCheckpoint = Date.now();

    const cleanup = () => {
        clearInterval(cancelPoll);
        cancelProbe.dispose();
        if (signal) signal.removeEventListener('abort', onCancel);
    };

    try {
        try {
            await llm.chatWithContextStreaming(
                message,
                history,
                toolContext,
                (chunk) => {
                    wrappedChunk(chunk);
                    if (chunk.type === 'text') {
                        fullResponse += chunk.text;
                        // Throttle checkpoints to ~1/s so we do not flood the disk
                        // with chunk-rate writes.
                        const now = Date.now();
                        if (now - lastCheckpoint > 1_000) {
                            lastCheckpoint = now;
                            void saveRunCheckpointSafe(workDir, {
                                runId,
                                updatedAt: new Date().toISOString(),
                                phase: 'streaming',
                                partialResponse: fullResponse,
                            });
                        }
                    }
                },
                effectiveSignal,
                model,
                route,
                images,
            );
        } catch (err: unknown) {
            const elapsed = Date.now() - t0;
            log.error(MODULE, 'Turn error', {
                userId, sessionId, runId, elapsed,
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
            });
            const isAbort = err instanceof Error && err.name === 'AbortError';
            const cancelled = cancelProbe.isCancelled();
            const isErrorObj = err instanceof Error;
            const errorInfo = {
                message: isErrorObj ? err.message : String(err),
                ...(isErrorObj && err.name !== undefined && { name: err.name }),
                ...(isErrorObj && err.stack !== undefined && { stack: err.stack }),
            };
            if (cancelled || isAbort) {
                // Caller-initiated abort (e.g. SSE disconnect) and explicit
                // cancellation are both treated as cancellation rather than
                // failure so the audit trail stays honest.
                await updateRunStatusSafe(workDir, runId, 'cancelled', { lastError: errorInfo });
            } else {
                await updateRunStatusSafe(workDir, runId, 'failed', { lastError: errorInfo });
            }
            await appendRunEventSafe(workDir, runId, 'run_failed', {
                finishedAt: new Date().toISOString(),
                error: errorInfo,
            });
            await bumpRunMetrics(workDir, runId, {
                toolCallCount,
                totalDurationMs: elapsed,
            });
            throw err;
        }

        const output = fullResponse.trim();
        if (output) {
            await messageAdd(session.id, userId, 'assistant', output);
            await appendRunEventSafe(workDir, runId, 'user_message_saved', {
                role: 'assistant',
                sessionId: session.id,
                contentLength: output.length,
                ...(previewText(output) !== undefined && { contentPreview: previewText(output)! }),
            });
        }

        const elapsed = Date.now() - t0;
        await saveRunCheckpointSafe(workDir, {
            runId,
            updatedAt: new Date().toISOString(),
            phase: 'finalizing',
            partialResponse: fullResponse,
        });
        await bumpRunMetrics(workDir, runId, {
            toolCallCount,
            totalDurationMs: elapsed,
        });
        await updateRunStatusSafe(workDir, runId, 'completed');
        await appendRunEventSafe(workDir, runId, 'run_completed', {
            finishedAt: new Date().toISOString(),
            responseLength: output.length,
            ...(previewText(output) !== undefined && { outputPreview: previewText(output)! }),
        });

        log.info(MODULE, 'Turn done', {
            userId, sessionId, runId, elapsed,
            responseLen: output.length,
            toolCallCount,
        });
        return output;
    } finally {
        cleanup();
    }
}
