/**
 * Telegram bot integration tests — test the user-facing behavior by mocking
 * Telegraf internals and external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing
vi.mock('../../config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../config.js')>();
    return {
        ...actual,
        getTelegramBotToken: () => 'test-token-fake',
        getTelegramChatId: () => '12345',
    };
});

vi.mock('../../services/agent-runner.js', () => ({
    runAgentTurn: vi.fn(),
}));

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({
        userId: 'user1',
        workDir: '/tmp/telegram-test',
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    }),
    userGetByTenant: vi.fn(),
    userList: vi.fn().mockReturnValue([]),
}));

vi.mock('../../services/chat-service.js', () => ({
    sessionCreate: vi.fn().mockResolvedValue({ id: 'sess1' }),
    sessionDelete: vi.fn().mockResolvedValue(true),
    sessionGet: vi.fn().mockResolvedValue({ id: 'sess1' }),
}));

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

// Mock Telegraf so it doesn't actually connect
const { lastBot } = vi.hoisted(() => ({ lastBot: { ref: null as any } }));

vi.mock('telegraf', () => {
    class MockTelegraf {
        __handlers = new Map<string, Function>();
        __commandHandlers = new Map<string, Function>();
        start = vi.fn((handler: Function) => { this.__commandHandlers.set('start', handler); });
        command = vi.fn((name: string, handler: Function) => { this.__commandHandlers.set(name, handler); });
        on = vi.fn((filter: string | Function, handler: Function) => {
            const key = typeof filter === 'string' ? filter : 'text';
            this.__handlers.set(key, handler);
        });
        launch = vi.fn().mockResolvedValue(undefined);
        stop = vi.fn();
        telegram = {
            sendMessage: vi.fn(),
            getFileLink: vi.fn(),
        };
        constructor() { lastBot.ref = this; }
    }

    return { Telegraf: MockTelegraf };
});

vi.mock('telegraf/filters', () => ({
    message: vi.fn((type: string) => type),
}));

import { startTelegramBot } from '../telegram-bot.js';
import { runAgentTurn } from '../../services/agent-runner.js';
import { userGetByTenant, userList } from '../../services/user-service.js';
import { sessionCreate, sessionDelete } from '../../services/chat-service.js';
import { splitTelegramText } from '../../utils/telegram-html.js';

describe('Telegram Bot E2E', () => {
    let runtime: Awaited<ReturnType<typeof startTelegramBot>>;
    let bot: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Start the bot (mocked — doesn't actually connect)
        runtime = await startTelegramBot();
        bot = lastBot.ref;
    });

    it('text message triggers agent turn and returns HTML response', async () => {
        // Setup: authorized user
        vi.mocked(userGetByTenant).mockReturnValue({
            id: 'user1', name: 'Test', workspace: 'w', tenants: ['telegram:12345'], web_token: null,
        });
        vi.mocked(runAgentTurn).mockResolvedValue('**Bold** reply');

        const textHandler = bot.__handlers.get('text');
        expect(textHandler).toBeDefined();

        const replies: { text: string; extra?: any }[] = [];
        const mockCtx = {
            chat: { id: 12345 },
            message: { text: 'hello' },
            reply: vi.fn(async (text: string, extra?: any) => { replies.push({ text, extra }); }),
            replyWithPhoto: vi.fn(),
            sendChatAction: vi.fn().mockResolvedValue(undefined),
        };

        await textHandler!(mockCtx);
        // Give the async IIFE a tick to complete
        await new Promise((r) => setTimeout(r, 50));

        expect(vi.mocked(runAgentTurn)).toHaveBeenCalled();
        // Reply was sent (HTML parse mode)
        expect(mockCtx.reply).toHaveBeenCalled();
    });

    it('/new command resets session', async () => {
        vi.mocked(userGetByTenant).mockReturnValue({
            id: 'user1', name: 'Test', workspace: 'w', tenants: ['telegram:12345'], web_token: null,
        });

        const newHandler = bot.__commandHandlers.get('new');
        expect(newHandler).toBeDefined();

        const mockCtx = {
            chat: { id: 12345 },
            reply: vi.fn(),
        };

        await newHandler!(mockCtx);

        expect(vi.mocked(sessionDelete)).toHaveBeenCalled();
        expect(vi.mocked(sessionCreate)).toHaveBeenCalled();
        expect(mockCtx.reply).toHaveBeenCalledWith('已开启新会话。');
    });

    it('unauthorized user receives rejection message', async () => {
        vi.mocked(userGetByTenant).mockReturnValue(null);
        vi.mocked(userList).mockReturnValue([]);

        const textHandler = bot.__handlers.get('text');
        const mockCtx = {
            chat: { id: 99999 },
            message: { text: 'hello' },
            reply: vi.fn(),
            sendChatAction: vi.fn().mockResolvedValue(undefined),
        };

        await textHandler!(mockCtx);

        expect(mockCtx.reply).toHaveBeenCalledWith(
            expect.stringContaining('未授权'),
        );
        expect(vi.mocked(runAgentTurn)).not.toHaveBeenCalled();
    });

    it('long response is split into multiple messages', async () => {
        vi.mocked(userGetByTenant).mockReturnValue({
            id: 'user1', name: 'Test', workspace: 'w', tenants: ['telegram:12345'], web_token: null,
        });

        const longText = 'x'.repeat(8000);
        vi.mocked(runAgentTurn).mockResolvedValue(longText);

        const textHandler = bot.__handlers.get('text');
        const mockCtx = {
            chat: { id: 12345 },
            message: { text: 'generate long' },
            reply: vi.fn().mockResolvedValue(undefined),
            replyWithPhoto: vi.fn(),
            sendChatAction: vi.fn().mockResolvedValue(undefined),
        };

        await textHandler!(mockCtx);
        await new Promise((r) => setTimeout(r, 50));

        // splitTelegramText should split into multiple parts
        const parts = splitTelegramText(longText);
        expect(parts.length).toBeGreaterThan(1);
        // reply should have been called once per part
        expect(mockCtx.reply.mock.calls.length).toBe(parts.length);
    });
});
