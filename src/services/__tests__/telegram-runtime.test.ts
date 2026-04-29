import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    token: 'test-token',
    users: [] as Array<{ id: string; workDir?: string; stateDir?: string }>,
    prefsByWorkDir: new Map<string, { telegramBotEnabled?: boolean }>(),
    started: 0,
    stopped: 0,
}));

vi.mock('../../config.js', () => ({
    getTelegramBotToken: () => state.token,
}));

vi.mock('../user-service.js', () => ({
    userList: vi.fn(() => state.users),
}));

vi.mock('../user-prefs.js', () => ({
    loadUserPreferences: vi.fn(async (workDir: string) => state.prefsByWorkDir.get(workDir) ?? {}),
}));

vi.mock('../../platforms/telegram-bot.js', () => ({
    startTelegramBot: vi.fn(async () => {
        state.started += 1;
        return {
            stop: vi.fn(() => {
                state.stopped += 1;
            }),
            sendMessage: vi.fn(),
        };
    }),
}));

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('telegram-runtime', () => {
    beforeEach(() => {
        vi.resetModules();
        state.token = 'test-token';
        state.users = [];
        state.prefsByWorkDir = new Map();
        state.started = 0;
        state.stopped = 0;
    });

    it('does not start the bot when no user enabled it', async () => {
        const mod = await import('../telegram-runtime.js');

        const result = await mod.syncTelegramBotState();

        expect(result.active).toBe(false);
        expect(result.enabledByUsers).toBe(0);
        expect(state.started).toBe(0);
    });

    it('starts the bot when any user enables it', async () => {
        state.users = [{ id: 'alice', stateDir: '/tmp/alice' }];
        state.prefsByWorkDir.set('/tmp/alice', { telegramBotEnabled: true });
        const mod = await import('../telegram-runtime.js');

        const result = await mod.syncTelegramBotState();

        expect(result.active).toBe(true);
        expect(result.enabledByUsers).toBe(1);
        expect(state.started).toBe(1);
        expect(mod.getTelegramRuntime()).not.toBeNull();
    });

    it('stops the bot after the last user turns it off', async () => {
        state.users = [{ id: 'alice', stateDir: '/tmp/alice' }];
        state.prefsByWorkDir.set('/tmp/alice', { telegramBotEnabled: true });
        const mod = await import('../telegram-runtime.js');

        await mod.syncTelegramBotState();
        state.prefsByWorkDir.set('/tmp/alice', { telegramBotEnabled: false });
        const result = await mod.syncTelegramBotState();

        expect(result.active).toBe(false);
        expect(result.enabledByUsers).toBe(0);
        expect(state.stopped).toBe(1);
    });

    it('refuses to start when TELEGRAM_BOT_TOKEN is missing', async () => {
        state.token = '';
        const mod = await import('../telegram-runtime.js');

        const result = await mod.ensureTelegramBotStarted();

        expect(result.active).toBe(false);
        expect(result.reason).toBe('missing_token');
        expect(state.started).toBe(0);
    });
});