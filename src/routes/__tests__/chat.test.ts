import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const { mockWorkDir } = vi.hoisted(() => ({ mockWorkDir: { value: '' } }));

// Mock agent-runner to avoid real LLM calls
vi.mock('../../services/agent-runner.js', () => ({
    runAgentTurn: vi.fn(),
}));

// Mock user-service
vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn().mockImplementation(async () => ({
        userId: 'testuser',
        workDir: mockWorkDir.value,
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
    })),
}));

import { runAgentTurn } from '../../services/agent-runner.js';
import { chatRoute } from '../chat.js';
import { appendEvent } from '../../runtime/events.js';
import { _resetPending } from '../../utils/pending-confirm.js';

const cookie = signedCookie('testuser');

let workDir: string;

function buildApp() {
    const { app, router, mount } = createTestApp();
    chatRoute(router);
    mount();
    return app;
}

describe('POST /api/chat', () => {
    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'neo-chat-route-'));
        mockWorkDir.value = workDir;
        vi.clearAllMocks();
    });

    afterEach(() => {
        _resetPending();
        rmSync(workDir, { recursive: true, force: true });
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
            await appendEvent(workDir, opts.runId!, 'llm_chunk', {
                chunkType: 'text',
                text: 'Hello!',
            });
            await appendEvent(workDir, opts.runId!, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 6,
                outputPreview: 'Hello!',
            });
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
        expect(body).toContain('"type":"run"');
        expect(body).toContain('"type":"text"');
        expect(body).toContain('"cursor":');
        expect(body).toContain('"type":"done"');
    });

    it('SSE stream contains error event on LLM failure', async () => {
        const mockRun = vi.mocked(runAgentTurn);
        mockRun.mockImplementation(async (opts) => {
            await appendEvent(workDir, opts.runId!, 'run_failed', {
                finishedAt: new Date().toISOString(),
                error: { message: 'LLM exploded' },
            });
            throw new Error('LLM exploded');
        });

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

    it('bridges confirm_requested events into tool_confirm SSE chunks', async () => {
        const mockRun = vi.mocked(runAgentTurn);
        mockRun.mockImplementation(async (opts) => {
            void opts.confirmCallback?.({
                toolName: 'bash',
                args: { command: 'rm -rf /tmp/demo' },
            });
            await new Promise((resolve) => setTimeout(resolve, 10));
            await appendEvent(workDir, opts.runId!, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 0,
            });
            return '';
        });

        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hi', sessionId: 'sess1', confirmDangerous: true })
            .buffer(true);

        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"tool_confirm"');
        expect(res.text).toContain('"toolName":"bash"');
    });

    it('bridges confirm_resolved events into confirm_resolved SSE chunks', async () => {
        const mockRun = vi.mocked(runAgentTurn);
        mockRun.mockImplementation(async (opts) => {
            await appendEvent(workDir, opts.runId!, 'confirm_resolved', {
                actionId: 'action-1',
                status: 'approved',
                decidedBy: 'user',
            });
            await appendEvent(workDir, opts.runId!, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 0,
            });
            return '';
        });

        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hi', sessionId: 'sess1' })
            .buffer(true);

        expect(res.status).toBe(200);
        expect(res.text).toContain('"type":"confirm_resolved"');
        expect(res.text).toContain('"confirmStatus":"approved"');
    });
});
