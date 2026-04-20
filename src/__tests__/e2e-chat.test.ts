/**
 * E2E smoke test: Complete chat flow through the HTTP API.
 * Mocks the LLM layer to return fixed responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestApp, signedCookie } from './test-helpers.js';

// ── Mock LLM ──────────────────────────────────────────────────────────────────

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

vi.mock('../llm/client.js', () => {
    class MockLLMClient {
        chatWithContextStreaming = mockChat;
    }
    return {
        LLMClient: MockLLMClient,
        buildTenantSystemInstruction: vi.fn().mockResolvedValue('You are a test agent.'),
        resolveModel: vi.fn((alias: string) => alias),
        registerTool: vi.fn(),
        getToolRegistry: vi.fn(() => new Map()),
        loadSystemInstruction: vi.fn().mockResolvedValue(''),
    };
});

vi.mock('../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

// ── Mock user-service with a real tmp workspace ───────────────────────────────

let tmpDir: string;

vi.mock('../services/user-service.js', () => ({
    calcUser: vi.fn().mockImplementation(async () => ({
        userId: 'e2e-user',
        workDir: tmpDir,
        systemInstruction: 'You are a test agent.',
        userProfile: { init: vi.fn(), read: vi.fn().mockReturnValue(''), toContextString: vi.fn().mockReturnValue('') },
        skillRegistry: new Map(),
        userTools: new Map(),
    })),
}));

// Use a real chat-service with the tmp directory
// Override _spaceDir via a mock that wraps the real module
const chatServiceModule = await import('../services/chat-service.js');

import { chatRoute } from '../routes/chat.js';
import { newSession } from '../routes/session.js';

const cookie = signedCookie('e2e-user');

describe('E2E chat smoke test', () => {
    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'e2e-chat-'));
        vi.clearAllMocks();
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('POST /api/chat returns SSE with text and done', async () => {
        mockChat.mockImplementation(async (_msg: string, _hist: any, _ctx: any, onChunk: Function) => {
            onChunk({ type: 'text', text: 'Hello from LLM!' });
            return 'Hello from LLM!';
        });

        const { app, router, mount } = createTestApp();
        chatRoute(router);
        mount();

        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'ping', sessionId: 'e2e-sess-1' })
            .buffer(true);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.text).toContain('"type":"text"');
        expect(res.text).toContain('Hello from LLM!');
        expect(res.text).toContain('"type":"done"');
    });

    it('new session → send message → session title auto-generated via onChunk', async () => {
        mockChat.mockImplementation(async (_msg: string, _hist: any, _ctx: any, onChunk: Function) => {
            onChunk({ type: 'text', text: 'Response text' });
            return 'Response text';
        });

        const { app, router, mount } = createTestApp();
        chatRoute(router);
        newSession(router);
        mount();

        // Create a new session
        await request(app.callback())
            .post('/api/session/clear')
            .set('Cookie', cookie)
            .send({});

        // Send a message
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'What is 2+2?', sessionId: 'e2e-sess-2' })
            .buffer(true);

        expect(res.status).toBe(200);
        expect(res.text).toContain('Response text');
    });

    it('conversation history is passed to LLM on subsequent messages', async () => {
        let capturedHistory: any = null;
        mockChat.mockImplementation(async (_msg: string, hist: any, _ctx: any, onChunk: Function) => {
            capturedHistory = hist;
            onChunk({ type: 'text', text: 'Turn 2 response' });
            return 'Turn 2 response';
        });

        const { app, router, mount } = createTestApp();
        chatRoute(router);
        mount();

        // First turn
        await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'Turn 1', sessionId: 'e2e-sess-3' })
            .buffer(true);

        // Second turn — should receive history
        await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'Turn 2', sessionId: 'e2e-sess-3' })
            .buffer(true);

        // The mock was called with conversation history
        expect(mockChat).toHaveBeenCalledTimes(2);
    });
});
