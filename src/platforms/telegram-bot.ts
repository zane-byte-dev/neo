import { Telegraf } from 'telegraf';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../config.js';
import { LLMClient, type ToolContext } from '../llm/client.js';
import { calcUser, userGetByTenant, userList } from '../services/user-service.js';
import { messageAdd, messageList, sessionCreate, sessionDelete, sessionGet } from '../services/chat-service.js';

const llm = new LLMClient();
const TELEGRAM_MAX_MESSAGE = 3800;

export interface TelegramRuntime {
    stop(): void;
}

function splitTelegramText(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return ['(empty response)'];

    const parts: string[] = [];
    let rest = trimmed;
    while (rest.length > TELEGRAM_MAX_MESSAGE) {
        let cut = rest.lastIndexOf('\n', TELEGRAM_MAX_MESSAGE);
        if (cut < TELEGRAM_MAX_MESSAGE * 0.6) cut = TELEGRAM_MAX_MESSAGE;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }
    if (rest) parts.push(rest);
    return parts;
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

function formatHistory(rows: Awaited<ReturnType<typeof messageList>>): string {
    return rows
        .map((r) => `${r.role === 'assistant' ? 'Assistant' : 'User'}: ${r.content}`)
        .join('\n');
}

export async function startTelegramBot(): Promise<TelegramRuntime | null> {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('[Telegram] TELEGRAM_BOT_TOKEN not set, skip startup');
        return null;
    }

    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.start((ctx) => ctx.reply('Neo Telegram 已连接。发送 /new 可重置当前会话。'));

    bot.command('new', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = resolveTelegramUserId(chatId);
        if (!userId) {
            await ctx.reply('未授权：请在 space/config.json 的 users[].tenants 中配置 telegram:chatId。');
            return;
        }
        const sessionId = `tg-${chatId}`;
        await sessionDelete(sessionId, userId).catch(() => {});
        await sessionCreate(userId, sessionId);
        await ctx.reply('已开启新会话。');
    });

    bot.on('text', async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = resolveTelegramUserId(chatId);
        if (!userId) {
            await ctx.reply('未授权：请在 space/config.json 的 users[].tenants 中配置 telegram:chatId。');
            return;
        }

        const cleanText = ctx.message.text.trim();
        if (!cleanText) return;

        const sessionId = `tg-${chatId}`;
        let session = await sessionGet(sessionId, userId);
        if (!session) session = await sessionCreate(userId, sessionId);

        await ctx.sendChatAction('typing');

        const userCtx = await calcUser(userId);
        const historyRows = await messageList(sessionId, userId);
        const history = formatHistory(historyRows);
        await messageAdd(session.id, userId, 'user', cleanText);

        let fullResponse = '';
        const toolContext: ToolContext = {
            userId,
            sessionId,
            workDir: userCtx.workDir,
            systemInstruction: userCtx.systemInstruction,
            skillRegistry: userCtx.skillRegistry,
            userTools: userCtx.userTools,
        };

        try {
            await llm.chatWithContextStreaming(
                cleanText,
                history,
                toolContext,
                (chunk) => {
                    if (chunk.type === 'text') fullResponse += chunk.text;
                },
            );

            const output = fullResponse.trim() || '模型没有返回可显示内容。';
            for (const part of splitTelegramText(output)) {
                await ctx.reply(part);
            }
            await messageAdd(session.id, userId, 'assistant', output);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.reply(`处理失败：${msg}`);
        }
    });

    await bot.launch();
    console.log('[Telegram] ✅ bot started (Telegraf long polling)');

    return {
        stop(): void {
            bot.stop('shutdown');
        },
    };
}