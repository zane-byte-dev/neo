import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

vi.mock('@neo/agent/services/chat-service.js', () => ({
    sessionCreate: vi.fn().mockResolvedValue({ id: 'new-sess', title: '', start_time: Date.now(), is_current: 1, is_pinned: 0 }),
    sessionList: vi.fn().mockResolvedValue([
        { id: 's1', title: 'Chat 1', start_time: '2026-01-02T00:00:00Z', is_current: 0, is_pinned: 0 },
        { id: 's2', title: 'Chat 2', start_time: '2026-01-01T00:00:00Z', is_current: 1, is_pinned: 1 },
    ]),
    sessionPatch: vi.fn().mockResolvedValue({ id: 's1', title: 'Renamed' }),
    sessionDelete: vi.fn().mockResolvedValue(true),
    sessionSoftDelete: vi.fn().mockResolvedValue({ id: 's1', title: 'Chat 1' }),
    messageList: vi.fn().mockResolvedValue([
        { id: 1, role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00Z' },
        { id: 2, role: 'model', content: 'hi back', timestamp: '2026-01-01T00:00:01Z' },
    ]),
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({ workDir: '/tmp/workdir', stateDir: '/tmp/workdir' }),
}));

vi.mock('../../services/trash-service.js', () => ({
    trashRegisterSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@neo/runtime', () => ({
    listRunIds: vi.fn().mockReturnValue(['run_1']),
    loadRun: vi.fn().mockResolvedValue({
        id: 'run_1',
        userId: 'testuser',
        sessionId: 'sess1',
        createdAt: '2026-01-01T00:00:00Z',
    }),
    listRunEvents: vi.fn().mockResolvedValue([
        {
            id: 'evt1',
            runId: 'run_1',
            index: 0,
            type: 'tool_call_started',
            ts: '2026-01-01T00:00:00.100Z',
            payload: { toolName: 'bash', args: { command: 'pwd' } },
        },
        {
            id: 'evt2',
            runId: 'run_1',
            index: 1,
            type: 'tool_call_finished',
            ts: '2026-01-01T00:00:00.200Z',
            payload: { toolName: 'bash', outcome: 'success', resultPreview: '/tmp/workdir', resultId: 'res_1' },
        },
        {
            id: 'evt3',
            runId: 'run_1',
            index: 2,
            type: 'user_message_saved',
            ts: '2026-01-01T00:00:01.000Z',
            payload: { role: 'assistant', sessionId: 'sess1', contentLength: 7, contentPreview: 'hi back' },
        },
    ]),
}));

import { newSession } from '../session.js';
import { sessionPatch, sessionSoftDelete } from '@neo/agent/services/chat-service.js';
import { trashRegisterSession } from '../../services/trash-service.js';

const cookie = signedCookie('testuser');

function buildApp() {
    const { app, router, mount } = createTestApp();
    newSession(router);
    mount();
    return app;
}

describe('Session routes', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('GET /api/sessions returns session list', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/sessions')
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
        expect(res.body[0]).toHaveProperty('id');
        expect(res.body[0]).toHaveProperty('title');
    });

    it('POST /api/session/clear creates a new session', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/session/clear')
            .set('Cookie', cookie)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('DELETE /api/sessions/:id deletes a session', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .delete('/api/sessions/s1')
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(vi.mocked(sessionSoftDelete)).toHaveBeenCalledWith('s1', 'testuser');
        expect(vi.mocked(trashRegisterSession)).toHaveBeenCalledWith('/tmp/workdir', 's1', 'Chat 1');
    });

    it('PATCH /api/sessions/:id modifies title', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .patch('/api/sessions/s1')
            .set('Cookie', cookie)
            .send({ title: 'Renamed Chat' });
        expect(res.status).toBe(200);
        expect(vi.mocked(sessionPatch)).toHaveBeenCalledWith('s1', 'testuser', { title: 'Renamed Chat' });
    });

    it('PATCH /api/sessions/:id returns 404 for non-existent session', async () => {
        vi.mocked(sessionPatch).mockResolvedValueOnce(null);
        const app = buildApp();
        const res = await request(app.callback())
            .patch('/api/sessions/nonexistent')
            .set('Cookie', cookie)
            .send({ title: 'X' });
        expect(res.status).toBe(404);
    });

    it('GET /api/messages returns message list', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/messages')
            .query({ sessionId: 'sess1' })
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
        expect(res.body[1].role).toBe('assistant');
        expect(res.body[1].activityLog).toHaveLength(2);
        expect(res.body[1].activityLog[0].toolName).toBe('bash');
        expect(res.body[1].parts[0].type).toBe('activity');
    });

    it('GET /api/messages returns 400 without sessionId', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .get('/api/messages')
            .set('Cookie', cookie);
        expect(res.status).toBe(400);
    });
});
