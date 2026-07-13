import { describe, expect, it } from 'vitest';
import { createPiSseAdapterState, mapPiEventToSse } from '../pi-event-sse.js';

describe('mapPiEventToSse', () => {
    it('maps streaming, tool, confirmation, and terminal events', () => {
        const state = createPiSseAdapterState();
        expect(mapPiEventToSse({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } }, state)).toEqual({ type: 'text', text: 'hello' });
        expect(mapPiEventToSse({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } }, state)).toEqual({ type: 'thought', text: 'hmm' });
        expect(mapPiEventToSse({ type: 'tool_execution_start', toolName: 'knowledge_search', args: { query: 'x' } }, state)).toEqual({ type: 'tool_call', toolName: 'knowledge_search', args: { query: 'x' } });
        expect(mapPiEventToSse({ type: 'tool_execution_end', toolName: 'knowledge_search', result: { content: [{ type: 'text', text: 'done' }] } }, state)).toEqual({ type: 'tool_result', toolName: 'knowledge_search', result: 'done', truncated: false });
        expect(mapPiEventToSse({ type: 'extension_ui_request', id: 'confirm-1', method: 'confirm', title: 'Allow?', message: 'write' }, state)).toEqual({
            type: 'tool_confirm',
            confirmId: 'confirm-1',
            actionId: 'confirm-1',
            toolName: 'pi_extension_confirm',
            args: { title: 'Allow?', message: 'write' },
        });
        expect(mapPiEventToSse({ type: 'agent_settled' }, state)).toEqual({ type: 'done' });
        expect(state.terminalSent).toBe(true);
    });
});
