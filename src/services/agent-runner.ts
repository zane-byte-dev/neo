/**
 * agent-runner.ts — Shared "one conversation turn" logic.
 *
 * Encapsulates the full lifecycle of a single user→assistant exchange:
 *   1. Load user runtime context (calcUser)
 *   2. Ensure a session exists
 *   3. Read history, save user message
 *   4. Run LLM (streaming)
 *   5. Save assistant message
 *   6. Return the full response text
 *
 * Callers (HTTP route, Telegram bot, …) only supply IO-specific callbacks.
 */

import { LLMClient } from '../llm/client.js';
import type { StreamChunk, ToolContext } from '../llm/types.js';
import { resolveSmartRoute } from '../llm/model-router.js';
import { calcUser } from './user-service.js';
import { messageAdd, messageList, sessionCreate, sessionGet } from './chat-service.js';
import { rememberTurn } from '../memory/index.js';
import { log } from '../utils/logger.js';

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
}

/**
 * Run one agent turn and return the full assistant response text.
 * Throws on unrecoverable error (AbortError is re-thrown as-is).
 */
export async function runAgentTurn(opts: AgentRunOptions): Promise<string> {
    const { userId, sessionId, message, model: rawModel, images, signal, onChunk, onImage, onVideo, onTodo, confirmCallback } = opts;

    const t0 = Date.now();

    const userCtx = await calcUser(userId);

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
        model,
        tier: route.tier,
        score: route.score,
        confidence: route.confidence,
        messageLen: message.length,
        preview: message.slice(0, 100),
    });

    let session = await sessionGet(sessionId, userId);
    if (!session) session = await sessionCreate(userId, sessionId);

    const historyRows = await messageList(sessionId, userId);
    const history = historyRows.map((r) => ({
        role: r.role === 'assistant' || r.role === 'model' ? 'assistant' : 'user',
        content: r.content,
    }));

    await messageAdd(session.id, userId, 'user', message);

    const toolContext: ToolContext = {
        userId,
        sessionId,
        workDir: userCtx.workDir,
        systemInstruction: userCtx.systemInstruction,
        signal,
        skillRegistry: userCtx.skillRegistry,
        userTools: userCtx.userTools,
        imageCallback: onImage,
        videoCallback: onVideo,
        todoCallback: onTodo,
        confirmCallback,
    };

    let fullResponse = '';

    try {
        await llm.chatWithContextStreaming(
            message,
            history,
            toolContext,
            (chunk) => {
                onChunk?.(chunk);
                if (chunk.type === 'text') fullResponse += chunk.text;
            },
            signal,
            model,
            route,
            images,
        );
    } catch (err: unknown) {
        const elapsed = Date.now() - t0;
        log.error(MODULE, 'Turn error', {
            userId, sessionId, elapsed,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
    }

    const output = fullResponse.trim();
    if (output) {
        await messageAdd(session.id, userId, 'assistant', output);
        // Fire-and-forget: persist the turn as an episodic memory card.
        // Best-effort; errors are logged inside rememberTurn and must not
        // affect the user-visible response.
        void rememberTurn(userCtx.workDir, {
            sessionId: session.id,
            userId,
            userMsg: message,
            assistantMsg: output,
        });
    }

    log.info(MODULE, 'Turn done', { userId, sessionId, elapsed: Date.now() - t0, responseLen: output.length });
    return output;
}
