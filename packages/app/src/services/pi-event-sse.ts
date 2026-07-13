import type { PiRpcMessage } from './pi-rpc-bridge.js';

export interface PiSseAdapterState {
    terminalSent: boolean;
}

export function createPiSseAdapterState(): PiSseAdapterState {
    return { terminalSent: false };
}

export function mapPiEventToSse(event: PiRpcMessage, state: PiSseAdapterState): Record<string, unknown> | null {
    switch (event.type) {
        case 'message_update': {
            const update = event.assistantMessageEvent as { type?: unknown; delta?: unknown; reason?: unknown } | undefined;
            if (update?.type === 'text_delta' && typeof update.delta === 'string') {
                return { type: 'text', text: update.delta };
            }
            if (update?.type === 'thinking_delta' && typeof update.delta === 'string') {
                return { type: 'thought', text: update.delta };
            }
            if (update?.type === 'error') {
                return { type: 'error', text: typeof update.reason === 'string' ? update.reason : 'pi model error' };
            }
            return null;
        }
        case 'tool_execution_start':
            return {
                type: 'tool_call',
                toolName: event.toolName,
                ...(isRecord(event.args) ? { args: event.args } : {}),
            };
        case 'tool_execution_end': {
            const result = event.result as { content?: Array<{ type?: string; text?: string }>; details?: unknown } | undefined;
            const text = result?.content?.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n') ?? '';
            return {
                type: 'tool_result',
                toolName: event.toolName,
                result: text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text,
                truncated: text.length > 2_000,
            };
        }
        case 'extension_ui_request':
            if (event.method === 'confirm') {
                return {
                    type: 'tool_confirm',
                    confirmId: event.id,
                    actionId: event.id,
                    toolName: 'pi_extension_confirm',
                    args: { title: event.title, message: event.message },
                };
            }
            return null;
        case 'auto_retry_start':
            return { type: 'thought', text: `Retrying after ${String(event.delayMs ?? 'a delay')}ms…` };
        case 'extension_error':
            return { type: 'error', text: typeof event.error === 'string' ? event.error : 'pi extension error' };
        case 'agent_settled':
            state.terminalSent = true;
            return { type: 'done' };
        default:
            return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
