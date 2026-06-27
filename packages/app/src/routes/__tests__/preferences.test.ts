/**
 * Tests for /api/preferences GET/POST.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const {
    calcUserMock,
    saveUserPreferencesMock,
    ensureTelegramBotStartedMock,
    getTelegramRuntimeStateMock,
    syncTelegramBotStateMock,
} = vi.hoisted(() => ({
    calcUserMock: vi.fn(),
    saveUserPreferencesMock: vi.fn(),
    ensureTelegramBotStartedMock: vi.fn(),
    getTelegramRuntimeStateMock: vi.fn(),
    syncTelegramBotStateMock: vi.fn(),
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: calcUserMock,
    invalidateUserCache: vi.fn(),
}));

vi.mock('@neo/agent/services/user-prefs.js', () => ({
    saveUserPreferences: saveUserPreferencesMock,
}));

vi.mock('../../services/telegram-runtime.js', () => ({
    ensureTelegramBotStarted: ensureTelegramBotStartedMock,
    getTelegramRuntimeState: getTelegramRuntimeStateMock,
    syncTelegramBotState: syncTelegramBotStateMock,
}));

vi.mock('@neo/agent/config.js', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@neo/agent/config.js');
    return {
        ...actual,
        MODEL_ALIASES: { deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' },
    };
});

beforeEach(() => {
    calcUserMock.mockResolvedValue({
        workDir: '/tmp/work',
        stateDir: '/tmp/state',
        preferences: { defaultModel: 'deepseek' },
    });
    saveUserPreferencesMock.mockImplementation(async (_dir: string, p: unknown) => p);
    getTelegramRuntimeStateMock.mockReturnValue({ active: false, reason: 'not_started' });
    syncTelegramBotStateMock.mockResolvedValue({ active: false, reason: 'not_started' });
    ensureTelegramBotStartedMock.mockResolvedValue({ active: true, reason: 'ok' });
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
        expect(res.body.availableModels).toEqual(['deepseek', 'claude']);
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
                enabledModels: ['deepseek', 'unknown-model', 'claude'],
                garbage: true,
            });
        expect(res.status).toBe(200);
        expect(saveUserPreferencesMock).toHaveBeenCalled();
        const saved = saveUserPreferencesMock.mock.calls[0][1];
        expect(saved.defaultModel).toBe('deepseek');
        expect(saved.enabledModels).toEqual(['deepseek', 'claude']);
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
