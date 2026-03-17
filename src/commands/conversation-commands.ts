import { geminiGenerate } from '../lib/gemini-client.js';
import type { ChatHistoryCache, Message } from '../lib/chat-history-cache.js';

interface ConversationDeps {
    bot: any;
    chatHistoryCache: ChatHistoryCache;
}

export async function tryHandleConversationCommand(
    command: string,
    ctx: any,
    deps: ConversationDeps,
): Promise<boolean> {
    if (command !== '/compact') return false;

    const msgs = deps.chatHistoryCache.getCurrentSessionHistory();
    if (msgs.length < 3) {
        await ctx.reply('💬 当前对话太短（< 3 条），无需压缩。');
        return true;
    }

    const statusMsg = await deps.bot.telegram.sendMessage(ctx.chat.id, '⏳ 正在压缩上下文...');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 需要配置 GEMINI_API_KEY。').catch(() => {});
        return true;
    }

    const transcript = msgs.map((m: Message) => {
        const role = m.role === 'user' ? (m.userName ?? 'User') : 'Assistant';
        const body = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
        return `${role}: ${body}`;
    }).join('\n\n');

    const summary = await geminiGenerate(
        apiKey,
        [{ parts: [{ text: `请将以下对话压缩为简洁的上下文摘要（5-10行），保留关键事实、决策和待办项，供后续对话参考：\n\n${transcript}` }] }],
        { generationConfig: { temperature: 0.2, maxOutputTokens: 600 } }
    );

    if (!summary) {
        await deps.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 压缩失败，请重试。').catch(() => {});
        return true;
    }

    await deps.chatHistoryCache.compactWithSummary(summary);
    await deps.bot.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        `✅ 上下文已压缩（${msgs.length} 条 → 1 条摘要）\n\n**摘要：**\n${summary}`,
        { parse_mode: 'Markdown' }
    ).catch(async () => {
        await ctx.reply(`✅ 已压缩 ${msgs.length} 条消息。\n\n摘要：\n${summary}`);
    });

    return true;
}
