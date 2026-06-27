/**
 * Web/SSE adapter for runtime run events.
 *
 * Runtime events stay transport-neutral; this adapter maps them to the current
 * Web chat StreamChunk shape and handles polling until a terminal event.
 */

import { listRunEvents, type RunEvent } from '@neo/runtime';
import { log } from '@neo/agent/utils/logger.js';

const MODULE = 'RunEventSseAdapter';
const EVENT_POLL_MS = 25;
const TERMINAL_GRACE_MS = 300;

interface EventBridgeState {
    cursor: number;
    terminalSent: boolean;
    pendingToolResults: Map<string, { resultId?: string; truncated?: boolean }>;
}

export interface RunEventSseBridge {
    readonly state: EventBridgeState;
    readonly promise: Promise<void>;
    readonly terminalSent: boolean;
    waitForTerminal(): Promise<void>;
}

export interface StartRunEventSseBridgeInput {
    stateDir: string;
    runId: string;
    send: (data: unknown) => void;
    signal: AbortSignal;
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
    stateDir: string,
    runId: string,
    send: (data: unknown) => void,
    signal: AbortSignal,
    state: EventBridgeState,
): Promise<void> {
    while (!signal.aborted && !state.terminalSent) {
        try {
            const events = await listRunEvents(stateDir, runId, {
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

export function startRunEventSseBridge(input: StartRunEventSseBridgeInput): RunEventSseBridge {
    const state: EventBridgeState = {
        cursor: -1,
        terminalSent: false,
        pendingToolResults: new Map(),
    };
    const promise = bridgeRunEvents(input.stateDir, input.runId, input.send, input.signal, state);
    return {
        state,
        promise,
        get terminalSent() {
            return state.terminalSent;
        },
        async waitForTerminal(): Promise<void> {
            if (state.terminalSent || input.signal.aborted) return;
            await Promise.race([
                promise,
                waitForSignalOrTimeout(input.signal, TERMINAL_GRACE_MS),
            ]);
        },
    };
}
