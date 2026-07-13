import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const state = vi.hoisted(() => ({ workDir: '', runPiChat: vi.fn() }));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn(async () => ({
        userId: 'testuser',
        workDir: state.workDir,
        stateDir: state.workDir,
        preferences: {},
        userProfile: {},
    })),
}));

vi.mock('../../services/pi-chat.js', () => ({
    runPiChat: state.runPiChat,
}));

import { chatRoute } from '../chat.js';

const cookie = signedCookie('testuser');

function buildApp() {
    const { app, router, mount } = createTestApp();
    chatRoute(router);
    mount();
    return app;
}

describe('POST /api/chat pi-only route', () => {
    beforeEach(() => {
        state.workDir = mkdtempSync(join(tmpdir(), 'neo-chat-pi-'));
        state.runPiChat.mockReset();
        state.runPiChat.mockImplementation(async (input: { runId: string; send: (event: unknown) => void }) => {
            input.send({ type: 'text', text: 'hello', runId: input.runId });
            input.send({ type: 'done', runId: input.runId });
        });
    });

    afterEach(() => rmSync(state.workDir, { recursive: true, force: true }));

    it('rejects a request without a session id', async () => {
        const response = await request(buildApp().callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hello' });
        expect(response.status).toBe(400);
    });

    it('uses pi even when an old client requests the retired legacy runtime', async () => {
        const response = await request(buildApp().callback())
            .post('/api/chat')
            .set('Cookie', cookie)
            .send({ message: 'hello', sessionId: 'session-1', runtime: 'legacy' })
            .buffer(true);

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');
        expect(response.text).toContain('"type":"text"');
        expect(response.text).toContain('"type":"done"');
        expect(state.runPiChat).toHaveBeenCalledOnce();
    });
});
