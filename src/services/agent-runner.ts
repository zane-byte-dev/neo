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
import { resolveAgentProfile } from '../agent/profiles/index.js';
import type { ResolvedProfile } from '../agent/profiles/types.js';
import { rememberTurn } from '../memory/index.js';
import { calcUser } from './user-service.js';
import { messageAdd, messageList, sessionCreate, sessionGet } from './chat-service.js';
import { citationsFromText, disposeRegistry } from './notebook-citation-registry.js';
import { touchProject } from './project-registry.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { log } from '../utils/logger.js';
import { createRun, loadRun, newRunId } from '../runtime/store.js';
import { loadCheckpoint } from '../runtime/checkpoint.js';
import { loadPendingAction } from '../runtime/pending-actions.js';
import {
    appendRunEventSafe,
    bumpRunMetrics,
    deleteRunCheckpointSafe,
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
    onImage?: (data: string, mimeType: string, caption?: string) => Promise<AgentArtifactInfo | void>;
    /** Called when a video is generated */
    onVideo?: (url: string) => Promise<AgentArtifactInfo | void>;
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
    * persisted under `{stateDir}/runs/{runId}/`. Provide this
     * when the caller (e.g. HTTP route) needs to surface the runId
     * to a client before the turn starts.
     */
    runId?: string;
    /** Logical entrypoint of the run (default: `web-chat`). */
    entrypoint?: RunEntrypoint;
    /** Triggering event type (default: `user_message`). */
    triggerType?: RunTriggerType;
    /** Optional agent profile id to apply (overrides entrypoint binding). */
    profile?: string;
    /** Optional notebook id when the run originates from a notebook. */
    notebook?: string;
    /** Optional parent run id for nested / forked executions. */
    parentRunId?: string;
    /** Free-form metadata persisted on `run.json`. */
    metadata?: JsonObject;
    /** Internal: skip persisting the current user message because it already exists in history. */
    persistUserMessage?: boolean;
    /** Internal: suppress an already-streamed text prefix when resuming a run. */
    suppressTextPrefix?: string;
    /**
     * Called once the runtime `run` has been created, before LLM work
     * starts. Useful for HTTP routes that want to surface the runId via
     * SSE on the first frame.
     */
    onRunCreated?: (runId: string) => void;
}

export interface AgentArtifactInfo {
    path?: string;
    url?: string;
    mimeType?: string;
    title?: string;
    metadata?: JsonObject;
}

export interface ResumeRunOptions {
    userId: string;
    runId: string;
    signal?: AbortSignal;
    onChunk?: (chunk: StreamChunk) => void;
    onImage?: (data: string, mimeType: string, caption?: string) => Promise<AgentArtifactInfo | void>;
    onVideo?: (url: string) => Promise<AgentArtifactInfo | void>;
    onTodo?: (todos: { id: number; title: string; status: string }[]) => void;
    confirmCallback?: (req: { toolName: string; args: Record<string, unknown> }) => Promise<boolean>;
}

function trimResumedPrefix(text: string, prefix: string): { emitted: string; remainingPrefix: string } {
    if (!prefix) return { emitted: text, remainingPrefix: '' };

    let matched = 0;
    const max = Math.min(text.length, prefix.length);
    while (matched < max && text[matched] === prefix[matched]) matched += 1;

    if (matched === 0) {
        return { emitted: text, remainingPrefix: '' };
    }

    const divergedWithinChunk = matched < text.length && matched < prefix.length;
    return {
        emitted: text.slice(matched),
        remainingPrefix: divergedWithinChunk ? '' : prefix.slice(matched),
    };
}

function sameJsonRecord(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

type AgentUserContext = Awaited<ReturnType<typeof calcUser>>;
type SessionRecord = Awaited<ReturnType<typeof sessionCreate>>;

interface ChatHistoryItem {
    role: 'assistant' | 'user';
    content: string;
}

interface NormalizedRunOptions extends Omit<AgentRunOptions, 'entrypoint' | 'triggerType' | 'persistUserMessage' | 'suppressTextPrefix'> {
    entrypoint: RunEntrypoint;
    triggerType: RunTriggerType;
    persistUserMessage: boolean;
    suppressTextPrefix: string;
}

interface PreparedTurnContext {
    t0: number;
    options: NormalizedRunOptions;
    userCtx: AgentUserContext;
    stateDir: string;
    runId: string;
    route: ReturnType<typeof resolveSmartRoute>;
    model: string;
    session: SessionRecord;
    history: ChatHistoryItem[];
    /** Effective project root for tool cwd (session.project_root || userCtx.workDir). */
    projectRoot: string;
    /** System instruction with optional {projectRoot}/.neo/AGENTS.md appended. */
    systemInstruction: string;
    /** Effective agent profile resolved for this turn. */
    profile: ResolvedProfile;
}

function normalizeRunOptions(opts: AgentRunOptions): NormalizedRunOptions {
    return {
        ...opts,
        entrypoint: opts.entrypoint ?? 'web-chat',
        triggerType: opts.triggerType ?? 'user_message',
        persistUserMessage: opts.persistUserMessage ?? true,
        suppressTextPrefix: opts.suppressTextPrefix ?? '',
    };
}

async function prepareRunContext(options: NormalizedRunOptions, t0: number): Promise<PreparedTurnContext> {
    const {
        userId,
        sessionId,
        message,
        model: rawModel,
        images,
        runId: requestedRunId,
        entrypoint,
        triggerType,
        notebook,
        parentRunId,
        metadata,
        persistUserMessage,
        onRunCreated,
        profile: requestedProfileId,
    } = options;

    const userCtx = await calcUser(userId);
    const stateDir = userCtx.stateDir ?? userCtx.workDir;

    const runId = requestedRunId ?? newRunId();
    const wantsCreate = !requestedRunId || !(await loadRun(stateDir, runId));
    if (wantsCreate) {
        try {
            await createRun(stateDir, {
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
            await appendRunEventSafe(stateDir, runId, 'run_created', {
                status: 'queued',
                entrypoint,
                triggerType,
            });
        } catch (err: unknown) {
            log.warn(MODULE, 'createRun failed', {
                runId,
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    onRunCreated?.(runId);

    // Resolve the effective agent profile for this turn (explicit request >
    // entrypoint binding > default). The `default` profile is unconstrained,
    // so absent config reproduces current behaviour.
    const profile = resolveAgentProfile(entrypoint, requestedProfileId);

    const userPickedModel = !!rawModel && rawModel !== 'auto';
    const effectiveUserModel = userPickedModel
        ? rawModel
        : profile.model ?? userCtx.preferences.defaultModel ?? rawModel;
    const route = resolveSmartRoute({ userModel: effectiveUserModel });
    const model = route.model;

    log.info(MODULE, 'Turn start', {
        userId,
        sessionId,
        runId,
        model,
        messageLen: message.length,
        preview: message.slice(0, 100),
    });

    await updateRunStatusSafe(stateDir, runId, 'running');
    await appendRunEventSafe(stateDir, runId, 'run_started', {
        startedAt: new Date().toISOString(),
    });
    await appendRunEventSafe(stateDir, runId, 'route_resolved', { model });

    const session = await sessionGet(sessionId, userId) ?? await sessionCreate(userId, sessionId);
    const historyRows = await messageList(sessionId, userId);
    let history: ChatHistoryItem[] = historyRows.map((r) => ({
        role: r.role === 'assistant' || r.role === 'model' ? 'assistant' : 'user',
        content: r.content,
    }));

    if (!persistUserMessage) {
        const last = history[history.length - 1];
        if (last?.role === 'user' && last.content === message) {
            history = history.slice(0, -1);
        }
    }

    if (persistUserMessage) {
        await messageAdd(session.id, userId, 'user', message);
        await appendRunEventSafe(stateDir, runId, 'user_message_saved', {
            role: 'user',
            sessionId: session.id,
            contentLength: message.length,
            ...(previewText(message) !== undefined && { contentPreview: previewText(message)! }),
        });
    }

    // Resolve effective project root for this turn. Defaults to the user's
    // home workDir; sessions may override it via SessionRow.project_root.
    const projectRoot = session.project_root && session.project_root.trim()
        ? session.project_root.trim()
        : userCtx.workDir;

    let systemInstruction = userCtx.systemInstruction || '';
    if (projectRoot !== userCtx.workDir) {
        try {
            const projAgents = await fs.readFile(join(projectRoot, '.neo', 'AGENTS.md'), 'utf8');
            const trimmed = projAgents.trim();
            if (trimmed) {
                systemInstruction = systemInstruction
                    ? `${systemInstruction}\n\n[Project Instructions @ ${projectRoot}]\n${trimmed}`
                    : `[Project Instructions @ ${projectRoot}]\n${trimmed}`;
            }
        } catch { /* no project-level AGENTS.md, ignore */ }
        // Best-effort recent-list bump.
        void touchProject(userId, projectRoot).catch(() => { /* non-fatal */ });
    }

    // Notebook-mode session: append source-grounding rules + bind to notebook tools.
    if (session.mode === 'notebook' && session.notebook_id) {
        const notebookRules = [
            `[Notebook Mode — "${session.notebook_id}"]`,
            '你当前绑定于 notebook 「' + session.notebook_id + '」。回答问题时必须遵守以下规则：',
            '1. 遇到事实性 / 内容性问题时，先调用 `notebook_search` 检索相关来源段落。',
            '2. 仅基于检索返回的来源事实回答；若来源中没有相关信息，请如实说明「来源中未找到相关内容」，不要编造。',
            '3. 在引用来源信息的句末使用【N】标记，N 为工具返回的来源编号；可叠加多个，如「…【１】【３】」。',
            '4. 不要输出「根据来源 N」之类的前缀——直接用【N】脚注即可。',
            '5. 不要使用任何写入类工具（编辑、写文件、安装、运行命令等）；notebook 模式下仅可读取与检索。',
        ].join('\n');
        systemInstruction = systemInstruction
            ? `${systemInstruction}\n\n${notebookRules}`
            : notebookRules;
    }

    // Inject profile personality (if any) as the final system-prompt block.
    if (profile.personality && profile.personality.trim()) {
        const personalityBlock = `[Agent Profile — ${profile.name}]\n${profile.personality.trim()}`;
        systemInstruction = systemInstruction
            ? `${systemInstruction}\n\n${personalityBlock}`
            : personalityBlock;
    }

    return {
        t0,
        options,
        userCtx,
        stateDir,
        runId,
        route,
        model,
        session,
        history,
        projectRoot,
        systemInstruction,
        profile,
    };
}

async function executeRunLoop(prepared: PreparedTurnContext): Promise<string> {
    const {
        t0,
        options,
        userCtx,
        stateDir,
        runId,
        route,
        model,
        session,
        history,
        projectRoot,
        systemInstruction,
        profile,
    } = prepared;
    const {
        userId,
        sessionId,
        message,
        images,
        signal,
        onChunk,
        onImage,
        onVideo,
        onTodo,
        confirmCallback,
        suppressTextPrefix,
    } = options;

    const cancelProbe = startCancellationProbe(stateDir, runId);
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

    let toolCallCount = 0;
    const toolStarts = new Map<string, number>();

    const wrappedChunk = (chunk: StreamChunk) => {
        onChunk?.(chunk);
        const text = (chunk as { text?: string }).text;
        const args = (chunk as { args?: Record<string, unknown> }).args;
        const toolName = (chunk as { toolName?: string }).toolName;
        const resultId = (chunk as { resultId?: string }).resultId;
        const truncated = (chunk as { truncated?: boolean }).truncated;
        // For text/thought chunks the persisted text is replayed verbatim
        // by the SSE bridge in /api/chat, so we must preserve the original
        // whitespace (leading/trailing spaces, newlines). Only non-text
        // chunk payloads use the preview helper.
        const isTextChunk = chunk.type === 'text' || chunk.type === 'thought';
        const persistedText = text === undefined
            ? undefined
            : isTextChunk
                ? text
                : (previewText(text, 500) ?? text);
        void appendRunEventSafe(stateDir, runId, 'llm_chunk', {
            chunkType: chunk.type,
            ...(persistedText !== undefined && { text: persistedText }),
            ...(toolName !== undefined && { toolName }),
            ...(args !== undefined && { args: args as JsonObject }),
            ...(resultId !== undefined && { resultId }),
            ...(truncated !== undefined && { truncated }),
        });
        if (chunk.type === 'tool_call') {
            toolCallCount += 1;
            toolStarts.set(`${toolName ?? 'tool'}:${toolCallCount}`, Date.now());
            void appendRunEventSafe(stateDir, runId, 'tool_call_started', {
                toolName: toolName ?? 'unknown',
                ...(args !== undefined && { args: args as JsonObject }),
            });
        } else if (chunk.type === 'tool_result') {
            let startMs: number | undefined;
            for (const [k, v] of toolStarts) {
                if (k.startsWith(`${toolName}:`)) {
                    startMs = v;
                    toolStarts.delete(k);
                }
            }
            const durationMs = startMs ? Date.now() - startMs : undefined;
            const previewSrc = (chunk as { result?: string }).result;
            void appendRunEventSafe(stateDir, runId, 'tool_call_finished', {
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
            void appendRunEventSafe(stateDir, runId, 'todo_updated', { todos: normalised });
        }
        : undefined;

    const wrappedImage = onImage
        ? async (data: string, mimeType: string, caption?: string) => {
            const artifactInfo = await onImage(data, mimeType, caption);
            void appendRunEventSafe(stateDir, runId, 'artifact_created', {
                artifact: {
                    id: `art_${Date.now().toString(36)}`,
                    runId,
                    kind: 'image',
                    createdAt: new Date().toISOString(),
                    mimeType: artifactInfo?.mimeType ?? mimeType,
                    ...(artifactInfo?.path !== undefined && { path: artifactInfo.path }),
                    ...(artifactInfo?.url !== undefined && { url: artifactInfo.url }),
                    ...((artifactInfo?.title ?? caption) !== undefined && { title: artifactInfo?.title ?? caption }),
                    ...(artifactInfo?.metadata !== undefined && { metadata: artifactInfo.metadata }),
                },
            });
        }
        : undefined;

    const wrappedVideo = onVideo
        ? async (url: string) => {
            const artifactInfo = await onVideo(url);
            void appendRunEventSafe(stateDir, runId, 'artifact_created', {
                artifact: {
                    id: `art_${Date.now().toString(36)}`,
                    runId,
                    kind: 'video',
                    createdAt: new Date().toISOString(),
                    url: artifactInfo?.url ?? url,
                    ...(artifactInfo?.path !== undefined && { path: artifactInfo.path }),
                    ...(artifactInfo?.mimeType !== undefined && { mimeType: artifactInfo.mimeType }),
                    ...(artifactInfo?.title !== undefined && { title: artifactInfo.title }),
                    ...(artifactInfo?.metadata !== undefined && { metadata: artifactInfo.metadata }),
                },
            });
        }
        : undefined;

    const isNotebookSession = session.mode === 'notebook' && !!session.notebook_id;

    const toolContext: ToolContext = {
        userId,
        sessionId,
        workDir: projectRoot,
        homeWorkDir: userCtx.workDir,
        stateDir: userCtx.stateDir ?? userCtx.workDir,
        systemInstruction,
        signal: effectiveSignal,
        skillRegistry: userCtx.skillRegistry,
        userTools: userCtx.userTools,
        runId,
        ...(isNotebookSession && { mode: 'notebook' as const }),
        ...(isNotebookSession && session.notebook_id !== undefined && { notebookId: session.notebook_id }),
        ...(isNotebookSession && session.source_ids && session.source_ids.length > 0 && { sourceIds: session.source_ids }),
        ...(wrappedImage && { imageCallback: wrappedImage }),
        ...(wrappedVideo && { videoCallback: wrappedVideo }),
        ...(wrappedTodo && { todoCallback: wrappedTodo }),
        ...(confirmCallback && { confirmCallback }),
        profile,
    };

    let fullResponse = '';
    let lastCheckpoint = Date.now();
    let remainingSuppressedText = suppressTextPrefix;

    const cleanup = () => {
        clearInterval(cancelPoll);
        cancelProbe.dispose();
        if (signal) signal.removeEventListener('abort', onCancel);
        disposeRegistry(runId);
    };

    try {
        try {
            await llm.chatWithContextStreaming(
                message,
                history,
                toolContext,
                (chunk) => {
                    if (chunk.type === 'text') {
                        const { emitted, remainingPrefix } = trimResumedPrefix(chunk.text, remainingSuppressedText);
                        remainingSuppressedText = remainingPrefix;
                        if (emitted) wrappedChunk({ ...chunk, text: emitted });
                        fullResponse += chunk.text;
                        const now = Date.now();
                        if (now - lastCheckpoint > 1_000) {
                            lastCheckpoint = now;
                            void saveRunCheckpointSafe(stateDir, {
                                runId,
                                updatedAt: new Date().toISOString(),
                                phase: 'streaming',
                                partialResponse: fullResponse,
                            });
                        }
                        return;
                    }
                    wrappedChunk(chunk);
                },
                effectiveSignal,
                model,
                route,
                images,
            );
        } catch (err: unknown) {
            const elapsed = Date.now() - t0;
            log.error(MODULE, 'Turn error', {
                userId,
                sessionId,
                runId,
                elapsed,
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
                await updateRunStatusSafe(stateDir, runId, 'cancelled', { lastError: errorInfo });
            } else {
                await updateRunStatusSafe(stateDir, runId, 'failed', { lastError: errorInfo });
            }
            await appendRunEventSafe(stateDir, runId, 'run_failed', {
                finishedAt: new Date().toISOString(),
                error: errorInfo,
            });
            await bumpRunMetrics(stateDir, runId, {
                toolCallCount,
                totalDurationMs: elapsed,
            });
            await deleteRunCheckpointSafe(stateDir, runId);
            throw err;
        }

        const output = fullResponse.trim();
        const citations = isNotebookSession ? citationsFromText(runId, output) : [];
        if (output) {
            if (citations.length > 0) {
                await messageAdd(session.id, userId, 'assistant', output, undefined, { citations });
            } else {
                await messageAdd(session.id, userId, 'assistant', output);
            }
            await appendRunEventSafe(stateDir, runId, 'user_message_saved', {
                role: 'assistant',
                sessionId: session.id,
                contentLength: output.length,
                ...(previewText(output) !== undefined && { contentPreview: previewText(output)! }),
            });
            // Persist this turn to episodic memory (best-effort, non-blocking).
            // Gated by the profile memory policy — only `read-write` persists.
            if (profile.memory === 'read-write') {
                void rememberTurn(projectRoot, {
                    sessionId: session.id,
                    userId,
                    userMsg: message,
                    assistantMsg: output,
                }, stateDir);
            }
        }
        if (citations.length > 0) {
            await appendRunEventSafe(stateDir, runId, 'notebook_citations', { citations });
        }

        const elapsed = Date.now() - t0;
        await saveRunCheckpointSafe(stateDir, {
            runId,
            updatedAt: new Date().toISOString(),
            phase: 'finalizing',
            partialResponse: fullResponse,
        });
        await bumpRunMetrics(stateDir, runId, {
            toolCallCount,
            totalDurationMs: elapsed,
        });
        await updateRunStatusSafe(stateDir, runId, 'completed');
        await appendRunEventSafe(stateDir, runId, 'run_completed', {
            finishedAt: new Date().toISOString(),
            responseLength: output.length,
            ...(previewText(output) !== undefined && { outputPreview: previewText(output)! }),
        });
        await deleteRunCheckpointSafe(stateDir, runId);

        log.info(MODULE, 'Turn done', {
            userId,
            sessionId,
            runId,
            elapsed,
            responseLen: output.length,
            toolCallCount,
        });
        return output;
    } finally {
        cleanup();
    }
}

/**
 * Run one agent turn and return the full assistant response text.
 * Throws on unrecoverable error (AbortError is re-thrown as-is).
 */
export async function runAgentTurn(opts: AgentRunOptions): Promise<string> {
    const prepared = await prepareRunContext(normalizeRunOptions(opts), Date.now());
    return executeRunLoop(prepared);
}

/**
 * Resume a previously persisted run using its stored request/checkpoint.
 *
 * Current scope is intentionally narrow: text-only runs with a persisted
 * `request.message`. When a checkpoint already contains streamed text,
 * duplicate text chunks are suppressed on the resumed stream.
 */
export async function resumeRun(opts: ResumeRunOptions): Promise<string> {
    const userCtx = await calcUser(opts.userId);
    const stateDir = userCtx.stateDir ?? userCtx.workDir;
    const run = await loadRun(stateDir, opts.runId);

    if (!run) throw new Error(`Run not found: ${opts.runId}`);
    if (run.userId !== opts.userId) throw new Error(`Run does not belong to user: ${opts.runId}`);
    if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
        throw new Error(`Run is already terminal: ${run.status}`);
    }
    if (!run.sessionId) throw new Error('Run cannot be resumed without sessionId');
    if (!run.request.message) throw new Error('Run cannot be resumed without original message');
    if ((run.request.imageCount ?? 0) > 0 || (run.request.documentCount ?? 0) > 0) {
        throw new Error('Resume currently supports text-only runs');
    }

    const checkpoint = await loadCheckpoint(stateDir, run.id);
    const pending = await loadPendingAction(stateDir, run.id);

    if (pending?.status === 'pending') {
        throw new Error('Run is still waiting for a pending action decision');
    }
    if (pending && pending.status !== 'approved') {
        throw new Error(`Run cannot be resumed after pending action status=${pending.status}`);
    }

    const approvedToolName = typeof pending?.request.toolName === 'string'
        ? pending.request.toolName
        : undefined;
    const approvedArgs = pending?.request.args && typeof pending.request.args === 'object' && !Array.isArray(pending.request.args)
        ? pending.request.args as Record<string, unknown>
        : undefined;
    let approvedPendingConsumed = false;

    await updateRunStatusSafe(stateDir, run.id, 'running', { pendingActionId: undefined });

    return runAgentTurn({
        userId: opts.userId,
        sessionId: run.sessionId,
        runId: run.id,
        entrypoint: 'resume',
        triggerType: 'resume',
        notebook: run.notebook,
        parentRunId: run.parentRunId,
        message: run.request.message,
        model: run.request.model,
        signal: opts.signal,
        onChunk: opts.onChunk,
        onImage: opts.onImage,
        onVideo: opts.onVideo,
        onTodo: opts.onTodo,
        confirmCallback: async (req) => {
            if (
                pending?.status === 'approved'
                && !approvedPendingConsumed
                && approvedToolName === req.toolName
                && sameJsonRecord(approvedArgs, req.args)
            ) {
                approvedPendingConsumed = true;
                return true;
            }
            if (opts.confirmCallback) return opts.confirmCallback(req);
            return false;
        },
        persistUserMessage: false,
        suppressTextPrefix: checkpoint?.partialResponse ?? '',
    });
}
