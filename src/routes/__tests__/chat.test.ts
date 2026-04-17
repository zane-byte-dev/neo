import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

// Mock agent-runner to avoid real LLM calls
vi.mock('../../services/agent-runner.js', () => ({
    runAgentTurn: vi.fn(),
}));

// Mock user-service
vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({
        userId: 'testuser',
        workDir: '/tmp/test-workspace',
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
    }),
}));

import { runAgentTurn } from '../../services/agent-runner.js';
import { chatRoute } from '../chat.js';

const cookie = signedCookie('testuser');

function buildApp() {
    const { app, router, mount } = createTestApp();
    chatRoute(router);
    mount();
    return app;
}

describe('POST /api/chat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when message, images, and documents are all missing', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ sessionId: 'sess1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('required');
    });

    it('returns 400 when sessionId is missing', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hello' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('sessionId');
    });

    it('returns 400 when message is too long', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'a'.repeat(60_000), sessionId: 'sess1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('too long');
    });

    it('returns SSE stream with text chunk and done event', async () => {
        const mockRun = vi.mocked(runAgentTurn);
        mockRun.mockImplementation(async (opts) => {
            opts.onChunk?.({ type: 'text', text: 'Hello!' });
            return 'Hello!';
        });

        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hi', sessionId: 'sess1' })
            .buffer(true);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');

        const body = res.text;
        expect(body).toContain('"type":"text"');
        expect(body).toContain('"type":"done"');
    });

    it('SSE stream contains error event on LLM failure', async () => {
        const mockRun = vi.mocked(runAgentTurn);
        mockRun.mockRejectedValue(new Error('LLM exploded'));

        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hi', sessionId: 'sess1' })
            .buffer(true);

        expect(res.status).toBe(200);
        const body = res.text;
        expect(body).toContain('"type":"error"');
        expect(body).toContain('LLM exploded');
    });
});
