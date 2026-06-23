import { describe, it, expect } from 'vitest';
import { encodeAnthropicEvent, encodeAnthropicMessage, normalizeAnthropicRequest } from '../anthropic.js';

describe('Anthropic gateway adapter', () => {
    it('normalizes text messages, tool_use, and tool_result', () => {
        const normalized = normalizeAnthropicRequest({
            model: 'claude',
            system: [{ type: 'text', text: 'be useful' }],
            tools: [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
            messages: [
                { role: 'user', content: 'open package.json' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'package.json' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
            ],
        });

        expect(normalized.system).toBe('be useful');
        expect(normalized.tools).toHaveProperty('read_file');
        expect(normalized.messages.map((msg) => msg.role)).toEqual(['user', 'assistant', 'tool']);
    });

    it('encodes message and event stream shapes', () => {
        const response = encodeAnthropicMessage({
            id: 'msg_1',
            model: 'claude',
            content: [{ type: 'text', text: 'hello' }],
            stopReason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 2 },
        }) as { type: string; content: Array<{ type: string; text?: string }> };

        expect(response.type).toBe('message');
        expect(response.content[0].text).toBe('hello');
        expect(encodeAnthropicEvent('message_stop', { type: 'message_stop' })).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
});