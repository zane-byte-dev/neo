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
import { calcUser } from './user-service.js';
import { messageAdd, messageList, sessionCreate, sessionGet } from './chat-service.js';

const llm = new LLMClient();

export interface AgentRunOptions {
    userId: string;
    sessionId: string;
    message: string;
    /** Override the default model (alias or full id) */
    model?: string;
    /** Abort signal — caller can cancel mid-stream */
    signal?: AbortSignal;
    /** Called for every chunk from the LLM stream */
    onChunk?: (chunk: StreamChunk) => void;
    /** Called when the LLM produces an image */
    onImage?: (data: string, mimeType: string, caption?: string) => Promise<void>;
    /** Called when the todo list is updated */
    onTodo?: (todos: { id: number; title: string; status: string }[]) => void;
}

/**
 * Run one agent turn and return the full assistant response text.
 * Throws on unrecoverable error (AbortError is re-thrown as-is).
 */
export async function runAgentTurn(opts: AgentRunOptions): Promise<string> {
    const { userId, sessionId, message, model, signal, onChunk, onImage, onTodo } = opts;

    const userCtx = await calcUser(userId);

    let session = await sessionGet(sessionId, userId);
    if (!session) session = await sessionCreate(userId, sessionId);

    const historyRows = await messageList(sessionId, userId);
    const history = historyRows
        .map((r) => `${r.role === 'assistant' ? 'Assistant' : 'User'}: ${r.content}`)
        .join('\n');

    await messageAdd(session.id, userId, 'user', message);

    const toolContext: ToolContext = {
        userId,
        sessionId,
        workDir: userCtx.workDir,
        systemInstruction: userCtx.systemInstruction,
        skillRegistry: userCtx.skillRegistry,
        userTools: userCtx.userTools,
        imageCallback: onImage,
        todoCallback: onTodo,
    };

    let fullResponse = '';

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
    );

    const output = fullResponse.trim();
    if (output) {
        await messageAdd(session.id, userId, 'assistant', output);
    }

    return output;
}
