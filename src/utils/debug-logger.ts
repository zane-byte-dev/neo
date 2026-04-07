/**
 * debug-logger.ts — Thin shim over the unified logger.
 * Preserved for backwards-compatible imports in agent-runtime and other callers.
 *
 * All events are emitted at DEBUG level and are only written when
 * LOG_LEVEL=debug or DEBUG_LLM=1.
 */

import { log, isDebugEnabled } from './logger.js';
export { isDebugEnabled };

function trunc(s: string, limit = 2000): string {
    return s.length > limit ? s.slice(0, limit) + `…(+${s.length - limit})` : s;
}

export const dbg = {
    agentStart(model: string, contentsCount: number, lastUserMsg: string): void {
        log.debug('agent', 'agent_start', { model, contentsCount, lastUserMsg: trunc(lastUserMsg, 800) });
    },

    apiRequest(iter: number, model: string, contents: unknown[]): void {
        const summary = (contents as any[]).map(c => ({
            role: c.role,
            parts: JSON.stringify(c.parts).slice(0, 300),
        }));
        log.debug('agent', 'api_request', { iter, model, turns: contents.length, summary });
    },

    thought(iter: number, text: string): void {
        log.debug('agent', 'thought', { iter, text: trunc(text, 600) });
    },

    toolCall(iter: number, name: string, args: unknown): void {
        log.debug('agent', 'tool_call', { iter, name, args: args as Record<string, unknown> });
    },

    toolResult(iter: number, name: string, result: string): void {
        log.debug('agent', 'tool_result', { iter, name, result: trunc(result) });
    },

    modelText(iter: number, text: string): void {
        log.debug('agent', 'model_text', { iter, text: trunc(text) });
    },

    apiError(iter: number, err: unknown): void {
        log.debug('agent', 'api_error', { iter, error: err instanceof Error ? err.message : String(err) });
    },

    agentDone(totalIters: number, responseLen: number): void {
        log.debug('agent', 'agent_done', { totalIters, responseLen });
    },
};
