import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js';
import { runAgentTurn } from '../services/agent-runner.js';
import { userGetByTenant, userList } from '../services/user-service.js';
import { sessionCreate, sessionDelete } from '../services/chat-service.js';
import { log } from '../utils/logger.js';
import { markdownToTelegramHtml, splitTelegramText } from '../utils/telegram-html.js';

const MODULE = 'Telegram';

export interface TelegramRuntime {
    stop(): void;
    /** Send a message to a chat/channel — used by cron-agent and webhook */
    sendMessage(chatId: string | number, text: string, parseMode?: 'HTML' | 'Markdown'): Promise<void>;
}

function resolveTelegramUserId(chatId: string): string | null {
    const byTenant = userGetByTenant(`telegram:${chatId}`);
    if (byTenant) return byTenant.id;

    const users = userList();
    const bySameId = users.find((u) => u.id === chatId);
    if (bySameId) return bySameId.id;

    if (TELEGRAM_CHAT_ID && TELEGRAM_CHAT_ID === chatId) {
        if (users.length === 1) return users[0].id;
    }

    return null;
}

const UNAUTHORIZED_MSG = '未授权：请在 space/config.json 的 users[].tenants 中配置 telegram:chatId。';

async function authorize(
    ctx: { chat: { id: number | string }; reply: (text: string) => Promise<unknown> },
): Promise<{ chatId: string; userId: string } | null> {
    const chatId = String(ctx.chat.id);
    const userId = resolveTelegramUserId(chatId);
    if (!userId) {
        await ctx.reply(UNAUTHORIZED_MSG);
        return null;
    }
    return { chatId, userId };
}

export async function startTelegramBot(): Promise<TelegramRuntime | null> {
    if (!TELEGRAM_BOT_TOKEN) {
        log.info(MODULE, 'TELEGRAM_BOT_TOKEN not set, skip startup');
        return null;
    }

    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.start((ctx) => ctx.reply('Neo Telegram 已连接。发送 /new 可重置当前会话。'));

    // Accept any Telegraf context-like object so text/media handlers can share the same turn flow.
    async function handleAgentTurn(
        ctx: { reply: (text: string, extra?: Record<string, unknown>) => Promise<void>; replyWithPhoto: (photo: { source: Buffer }, extra?: { caption?: string }) => Promise<unknown>; sendChatAction: (action: string) => Promise<void> },
        userId: string, chatId: string, sessionId: string, userMessage: string,
    ): Promise<void> {
        await ctx.sendChatAction('typing').catch(() => {});

        void (async () => {
            const t0 = Date.now();
            try {
                const output = await runAgentTurn({
                    userId,
                    sessionId,
                    message: userMessage,
                    entrypoint: 'telegram',
                    triggerType: 'telegram_message',
                    metadata: { chatId },
                    onImage: async (data: string, _mimeType: string, caption?: string) => {
                        const buffer = Buffer.from(data, 'base64');
                        await ctx.replyWithPhoto({ source: buffer }, caption ? { caption } : undefined);
                    },
                });
                const elapsed = Date.now() - t0;
                log.info(MODULE, 'Turn completed', { chatId, sessionId, elapsed, responseLen: output.length });
                const text = output || '模型没有返回可显示内容。';
                for (const part of splitTelegramText(text)) {
                    const html = markdownToTelegramHtml(part);
                    try {
                        await ctx.reply(html, { parse_mode: 'HTML' });
                    } catch {
                        await ctx.reply(part);
                    }
                }
            } catch (err: unknown) {
                const elapsed = Date.now() - t0;
                const msg = err instanceof Error ? err.message : String(err);
                log.error(MODULE, 'Turn failed', { chatId, sessionId, elapsed, error: msg, stack: err instanceof Error ? err.stack : undefined });
                await ctx.reply(`处理失败：${msg}`).catch(() => {});
            }
        })();
    }

    bot.command('new', async (ctx) => {
        const auth = await authorize(ctx);
        if (!auth) return;
        const { chatId, userId } = auth;
        const sessionId = `tg-${chatId}`;
        await sessionDelete(sessionId, userId).catch(() => {});
        await sessionCreate(userId, sessionId);
        await ctx.reply('已开启新会话。');
    });

    bot.on('text', async (ctx) => {
        const auth = await authorize(ctx);
        if (!auth) return;
        const { chatId, userId } = auth;

        const cleanText = ctx.message.text.trim();
        if (!cleanText) return;

        const sessionId = `tg-${chatId}`;
        log.info(MODULE, 'Received message', { chatId, userId, sessionId, len: cleanText.length, preview: cleanText.slice(0, 80) });

        await handleAgentTurn(ctx, userId, chatId, sessionId, cleanText);
    });

    // ── Photo handler ─────────────────────────────────────────────────────────
    bot.on(message('photo'), async (ctx) => {
        const auth = await authorize(ctx);
        if (!auth) return;
        const { chatId, userId } = auth;

        const sessionId = `tg-${chatId}`;
        // ctx.message is narrowed by the filter at runtime
        const msg = ctx.message as unknown as { photo: Array<{ file_id: string }>; caption?: string };
        const largest = msg.photo[msg.photo.length - 1];
        const caption = msg.caption ?? '';

        try {
            const fileLink = await bot.telegram.getFileLink(largest.file_id);
            const userMsg = caption
                ? `[用户发送了图片: ${fileLink.href}]\n\n${caption}`
                : `[用户发送了图片: ${fileLink.href}]`;

            log.info(MODULE, 'Received photo', { chatId, userId, sessionId, fileId: largest.file_id });
            await handleAgentTurn(ctx, userId, chatId, sessionId, userMsg);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.reply(`处理图片失败：${errMsg}`).catch(() => {});
        }
    });

    // ── Document handler ──────────────────────────────────────────────────────
    bot.on(message('document'), async (ctx) => {
        const auth = await authorize(ctx);
        if (!auth) return;
        const { chatId, userId } = auth;

        const sessionId = `tg-${chatId}`;
        const msg = ctx.message as unknown as { document: { file_id: string; file_name?: string }; caption?: string };
        const doc = msg.document;
        const caption = msg.caption ?? '';

        try {
            const fileLink = await bot.telegram.getFileLink(doc.file_id);
            const fileName = doc.file_name ?? 'unknown';
            const userMsg = caption
                ? `[用户发送了文件: ${fileName} (${fileLink.href})]\n\n${caption}`
                : `[用户发送了文件: ${fileName} (${fileLink.href})]`;

            log.info(MODULE, 'Received document', { chatId, userId, sessionId, fileName });
            await handleAgentTurn(ctx, userId, chatId, sessionId, userMsg);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.reply(`处理文件失败：${errMsg}`).catch(() => {});
        }
    });

    // ── Voice handler ─────────────────────────────────────────────────────────
    bot.on(message('voice'), async (ctx) => {
        const auth = await authorize(ctx);
        if (!auth) return;
        const { chatId, userId } = auth;

        const sessionId = `tg-${chatId}`;
        const msg = ctx.message as unknown as { voice: { file_id: string; duration: number } };
        try {
            const fileLink = await bot.telegram.getFileLink(msg.voice.file_id);
            const duration = msg.voice.duration;
            const userMsg = `[用户发送了语音消息: ${duration}秒, ${fileLink.href}]`;

            log.info(MODULE, 'Received voice', { chatId, userId, sessionId, duration });
            await handleAgentTurn(ctx, userId, chatId, sessionId, userMsg);
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.reply(`处理语音失败：${errMsg}`).catch(() => {});
        }
    });

    await bot.launch();
    log.info(MODULE, 'Bot started (long polling)');

    return {
        stop(): void {
            bot.stop('shutdown');
        },
        async sendMessage(chatId: string | number, text: string, parseMode?: 'HTML' | 'Markdown'): Promise<void> {
            const opts = parseMode ? { parse_mode: parseMode as 'HTML' | 'Markdown' } : undefined;
            await bot.telegram.sendMessage(chatId, text, opts);
        },
    };
}