import { describe, it, expect } from 'vitest';
import { GatewayError } from '../errors.js';
import { encodeOpenAIChatCompletion, encodeOpenAIChunk, encodeOpenAIDone, normalizeOpenAIRequest } from '../openai.js';

describe('OpenAI gateway adapter', () => {
    it('normalizes text chat messages and system prompt', () => {
        const normalized = normalizeOpenAIRequest({
            model: 'auto',
            messages: [
                { role: 'system', content: 'be brief' },
                { role: 'user', content: [{ type: 'text', text: 'hi' }] },
                { role: 'assistant', content: 'hello' },
            ],
            temperature: 0.2,
            max_tokens: 128,
        });

        expect(normalized.model).toBe('auto');
        expect(normalized.system).toBe('be brief');
        expect(normalized.messages).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ]);
        expect(normalized.maxOutputTokens).toBe(128);
    });

    it('rejects unsupported content parts', () => {
        expect(() => normalizeOpenAIRequest({
            messages: [{ role: 'user', content: [{ type: 'image_url', url: 'https://example.com/a.png' }] }],
        })).toThrow(GatewayError);
    });

    it('encodes response and streaming chunks', () => {
        const response = encodeOpenAIChatCompletion({
            id: 'chatcmpl-1',
            model: 'flash',
            content: 'hello',
            finishReason: 'stop',
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }) as { choices: Array<{ message: { content: string } }> };
        expect(response.choices[0].message.content).toBe('hello');

        expect(encodeOpenAIChunk({ id: 'chatcmpl-1', model: 'flash', content: 'he' })).toContain('"content":"he"');
        expect(encodeOpenAIDone()).toBe('data: [DONE]\n\n');
    });
});