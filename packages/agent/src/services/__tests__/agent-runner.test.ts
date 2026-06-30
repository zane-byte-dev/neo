import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the module under test

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

vi.mock('../../llm/client.js', () => {
    class MockLLMClient {
        chatWithContextStreaming = mockChat;
    }
    return {
        LLMClient: MockLLMClient,
        buildTenantSystemInstruction: vi.fn().mockResolvedValue('system prompt'),
        resolveModel: vi.fn((alias: string) => alias),
        registerTool: vi.fn(),
        getToolRegistry: vi.fn(() => new Map()),
        loadSystemInstruction: vi.fn().mockResolvedValue(''),
    };
});

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({
        userId: 'u1',
        workDir: '/tmp/test',
        systemInstruction: 'Be helpful.',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    }),
}));

vi.mock('../../services/chat-service.js', () => ({
    sessionGet: vi.fn().mockResolvedValue({ id: 'sess1', title: 'Test', start_time: '', is_current: 1, is_pinned: 0 }),
    sessionCreate: vi.fn().mockResolvedValue({ id: 'sess1', title: '', start_time: '', is_current: 1, is_pinned: 0 }),
    messageAdd: vi.fn().mockResolvedValue(undefined),
    messageList: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

import { runAgentTurn } from '../agent-runner.js';
import { sessionGet, sessionCreate, messageAdd } from '../../services/chat-service.js';

describe('runAgentTurn', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('normal flow: loads user → get session → read history → call LLM → save messages', async () => {
        mockChat.mockImplementation(async (_msg: string, _hist: any, _ctx: any, onChunk: (chunk: unknown) => void) => {
            onChunk({ type: 'text', text: 'Hello!' });
            return 'Hello!';
        });

        const result = await runAgentTurn({
            userId: 'u1',
            sessionId: 'sess1',
            message: 'hi',
        });

        expect(result).toBe('Hello!');
        expect(vi.mocked(messageAdd)).toHaveBeenCalledTimes(2); // user + assistant
        expect(vi.mocked(messageAdd)).toHaveBeenCalledWith('sess1', 'u1', 'user', 'hi');
        expect(vi.mocked(messageAdd)).toHaveBeenCalledWith('sess1', 'u1', 'assistant', 'Hello!');
    });

    it('auto-creates session when not found', async () => {
        vi.mocked(sessionGet).mockResolvedValueOnce(null);
        mockChat.mockImplementation(async (_msg: string, _hist: any, _ctx: any, onChunk: (chunk: unknown) => void) => {
            onChunk({ type: 'text', text: 'ok' });
            return 'ok';
        });

        await runAgentTurn({ userId: 'u1', sessionId: 'new-sess', message: 'hi' });
        expect(vi.mocked(sessionCreate)).toHaveBeenCalledWith('u1', 'new-sess');
    });

    it('onChunk callback receives correct chunks', async () => {
        const chunks: any[] = [];
        mockChat.mockImplementation(async (_msg: string, _hist: any, _ctx: any, onChunk: (chunk: unknown) => void) => {
            onChunk({ type: 'text', text: 'A' });
            onChunk({ type: 'text', text: 'B' });
            return 'AB';
        });

        await runAgentTurn({
            userId: 'u1',
            sessionId: 'sess1',
            message: 'hi',
            onChunk: (c) => chunks.push(c),
        });
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ type: 'text', text: 'A' });
    });

    it('does not save assistant message when LLM returns empty text', async () => {
        mockChat.mockImplementation(async () => {
            return '';
        });

        await runAgentTurn({ userId: 'u1', sessionId: 'sess1', message: 'generate' });
        // Only user message saved, not assistant
        expect(vi.mocked(messageAdd)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(messageAdd)).toHaveBeenCalledWith('sess1', 'u1', 'user', 'generate');
    });

    it('re-throws AbortError as-is', async () => {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        mockChat.mockRejectedValue(abortErr);

        await expect(
            runAgentTurn({ userId: 'u1', sessionId: 'sess1', message: 'hi' }),
        ).rejects.toThrow('Aborted');
    });

    it('other errors are thrown with original message', async () => {
        mockChat.mockRejectedValue(new Error('API timeout'));

        await expect(
            runAgentTurn({ userId: 'u1', sessionId: 'sess1', message: 'hi' }),
        ).rejects.toThrow('API timeout');
    });
});
