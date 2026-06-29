/**
 * Tests for /api/preferences GET/POST.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const {
    calcUserMock,
    saveUserPreferencesMock,
} = vi.hoisted(() => ({
    calcUserMock: vi.fn(),
    saveUserPreferencesMock: vi.fn(),
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: calcUserMock,
    invalidateUserCache: vi.fn(),
}));

vi.mock('@neo/agent/services/user-prefs.js', () => ({
    saveUserPreferences: saveUserPreferencesMock,
}));

beforeEach(() => {
    calcUserMock.mockResolvedValue({
        workDir: '/tmp/work',
        stateDir: '/tmp/state',
        preferences: { defaultModel: 'deepseek' },
    });
    saveUserPreferencesMock.mockImplementation(async (_dir: string, p: unknown) => p);
});

describe('/api/preferences', () => {
    it('GET returns 401 without auth', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback()).get('/api/preferences');
        expect(res.status).toBe(401);
    });

    it('GET returns user preferences and only runtime-available models', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback())
            .get('/api/preferences')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(res.body.preferences.defaultModel).toBe('deepseek');
        expect(res.body.availableModels).toEqual(['deepseek', 'deepseek-reasoner']);
    });

    it('POST sanitizes incoming preferences and saves them', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback())
            .post('/api/preferences')
            .set('Cookie', signedCookie('u1'))
            .send({
                defaultModel: 'deepseek',
                enabledModels: ['deepseek', 'unknown-model', 'deepseek-reasoner'],
                garbage: true,
            });
        expect(res.status).toBe(200);
        expect(saveUserPreferencesMock).toHaveBeenCalled();
        const saved = saveUserPreferencesMock.mock.calls[0][1];
        expect(saved.defaultModel).toBe('deepseek');
        expect(saved.enabledModels).toEqual(['deepseek', 'deepseek-reasoner']);
        expect((saved as Record<string, unknown>).garbage).toBeUndefined();
    });

    it('POST defaultModel="auto" clears the default', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        await request(app.callback())
            .post('/api/preferences')
            .set('Cookie', signedCookie('u1'))
            .send({ defaultModel: 'auto' });
        const saved = saveUserPreferencesMock.mock.calls.at(-1)![1];
        expect(saved.defaultModel).toBeUndefined();
    });

    it('POST returns 401 without auth', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback()).post('/api/preferences').send({});
        expect(res.status).toBe(401);
    });
});
