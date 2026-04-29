/**
 * Tests for /api/preferences GET/POST.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const calcUserMock = vi.fn();
const saveUserPreferencesMock = vi.fn();
const ensureTelegramBotStartedMock = vi.fn();
const getTelegramRuntimeStateMock = vi.fn();
const syncTelegramBotStateMock = vi.fn();

vi.mock('../../services/user-service.js', () => ({
    calcUser: calcUserMock,
    invalidateUserCache: vi.fn(),
}));

vi.mock('../../services/user-prefs.js', () => ({
    saveUserPreferences: saveUserPreferencesMock,
}));

vi.mock('../../services/telegram-runtime.js', () => ({
    ensureTelegramBotStarted: ensureTelegramBotStartedMock,
    getTelegramRuntimeState: getTelegramRuntimeStateMock,
    syncTelegramBotState: syncTelegramBotStateMock,
}));

vi.mock('../../config.js', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../config.js');
    return {
        ...actual,
        MODEL_ALIASES: { flash: 'gemini-3-flash-preview', pro: 'gemini-2.5-pro' },
    };
});

beforeEach(() => {
    calcUserMock.mockResolvedValue({
        workDir: '/tmp/work',
        stateDir: '/tmp/state',
        preferences: { defaultModel: 'flash' },
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

    it('GET returns user preferences and available models', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback())
            .get('/api/preferences')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(res.body.preferences.defaultModel).toBe('flash');
        expect(res.body.availableModels).toEqual(expect.arrayContaining(['flash', 'pro']));
    });

    it('POST sanitizes incoming preferences and saves them', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback())
            .post('/api/preferences')
            .set('Cookie', signedCookie('u1'))
            .send({
                defaultModel: 'flash',
                enabledModels: ['flash', 'unknown-model', 'pro'],
                telegramBotEnabled: false,
                garbage: true,
            });
        expect(res.status).toBe(200);
        expect(saveUserPreferencesMock).toHaveBeenCalled();
        const saved = saveUserPreferencesMock.mock.calls[0][1];
        expect(saved.defaultModel).toBe('flash');
        expect(saved.enabledModels).toEqual(['flash', 'pro']);
        expect(saved.telegramBotEnabled).toBe(false);
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

    it('POST returns 409 when telegramBotEnabled=true but no token configured', async () => {
        ensureTelegramBotStartedMock.mockResolvedValueOnce({ active: false, reason: 'missing_token' });
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback())
            .post('/api/preferences')
            .set('Cookie', signedCookie('u1'))
            .send({ telegramBotEnabled: true });
        expect(res.status).toBe(409);
        expect(res.body.error).toContain('TELEGRAM');
    });

    it('POST returns 401 without auth', async () => {
        const { preferences } = await import('../preferences.js');
        const { app, router, mount } = createTestApp();
        preferences(router); mount();
        const res = await request(app.callback()).post('/api/preferences').send({});
        expect(res.status).toBe(401);
    });
});
