import { promises as fs } from 'fs';
import { resolve } from 'path';
import { parseReminderTime } from '../lib/reminder-manager.js';
import { parseScheduledTask } from '../lib/scheduled-task-manager.js';
import { hasPending, resolve as resolveUserInput } from '../lib/user-input-waiter.js';
import { setActiveChatId } from '../lib/tool-context.js';
import type { Task } from './types.js';

interface MessageRouterDeps {
    bot: any;
    isAuthorized: (chatId: number) => boolean;
    asyncTriggerPrefixes: string[];
    pendingReadMatches: Map<number, { matches: string[]; expiry: number }>;
    scheduledTaskManager: any;
    reminderManager: any;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
    handleAsyncTask: (ctx: any) => Promise<void>;
    handleCommand: (ctx: any) => Promise<void>;
    handleUrlMessage: (ctx: any, url: string, rawText: string, userName: string, chatId: number, messageId: number) => Promise<void>;
}

export async function processMessage(deps: MessageRouterDeps, ctx: any) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    const userName = ctx.chat.first_name || 'User';

    const replyTo = ctx.message.reply_to_message;
    const quotedText: string | null = replyTo?.text ?? replyTo?.caption ?? null;
    const rawText: string = ctx.message.text;
    const text = quotedText
        ? `[引用消息]: ${quotedText}\n\n[我的问题]: ${rawText}`
        : rawText;

    const preview = rawText.length > 50 ? `${rawText.substring(0, 50)}...` : rawText;
    console.log(`[Message] From ${userName} (ID: ${chatId}, MsgID: ${messageId}${quotedText ? ', replying to msg' : ''}): ${preview}`);

    if (!deps.isAuthorized(chatId)) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    // Update the active chat ID in tool context (for ask_user, schedule_create, etc.)
    setActiveChatId(chatId);

    // If ask_user tool is waiting for input, route this message directly to it
    if (hasPending(chatId)) {
        resolveUserInput(chatId, rawText);
        return;
    }

    if (rawText.startsWith('/')) {
        if (rawText.startsWith('/research') || rawText.startsWith('/async')) {
            await deps.handleAsyncTask(ctx);
            return;
        }
        if (rawText.startsWith('/btw')) {
            await handleBtwMessage(deps, ctx, rawText, chatId, messageId, userName);
            return;
        }
        await deps.handleCommand(ctx);
        return;
    }

    const quickPick = rawText.match(/^r(\d+)$/i);
    if (quickPick) {
        const pending = deps.pendingReadMatches.get(chatId);
        if (pending && pending.expiry > Date.now()) {
            const idx = parseInt(quickPick[1], 10) - 1;
            if (idx >= 0 && idx < pending.matches.length) {
                deps.pendingReadMatches.delete(chatId);
                const absPath = pending.matches[idx];
                const resolvedBase = resolve(process.env.WORK_DIR || process.cwd());
                const relPath = absPath.slice(resolvedBase.length + 1);
                try {
                    const stat = await fs.stat(absPath);
                    if (stat.size > 100 * 1024) {
                        await ctx.reply(`⚠️ 文件超过 100KB（${(stat.size / 1024).toFixed(1)}KB），请缩小范围。`);
                        return;
                    }
                    const content = await fs.readFile(absPath, 'utf8');
                    const MAX_MSG = 4000;
                    const header = `📄 ${relPath}\n\n`;
                    if (header.length + content.length <= MAX_MSG) {
                        await ctx.reply(header + content);
                    } else {
                        const chunks: string[] = [];
                        for (let i = 0; i < content.length; i += MAX_MSG - header.length) {
                            chunks.push(content.slice(i, i + MAX_MSG - header.length));
                        }
                        await ctx.reply(`📄 ${relPath} (${chunks.length} 段)\n\n${chunks[0]}`);
                        for (let i = 1; i < chunks.length; i++) {
                            await ctx.reply(chunks[i]).catch(() => {});
                        }
                    }
                } catch (err: any) {
                    await ctx.reply(`❌ 无法读取文件: ${err.message}`);
                }
                return;
            }
        }
    }

    if (deps.asyncTriggerPrefixes.some((prefix) => rawText.startsWith(prefix))) {
        await deps.handleAsyncTask(ctx);
        return;
    }

    const isScheduleIntent = /每(天|日|周|月|小时|隔|个工作日)/.test(rawText) ||
        /定期|每\d+(分钟|小时)/.test(rawText);
    if (isScheduleIntent) {
        await handleScheduledTaskMessage(deps, ctx, rawText, chatId, messageId);
        return;
    }

    const isReminderIntent = rawText.includes('提醒我') || /^\d+\s*(分钟|小时|天)后/.test(rawText);
    if (isReminderIntent) {
        await handleReminderMessage(deps, ctx, rawText, chatId, messageId);
        return;
    }

    const urlMatch = rawText.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        await deps.handleUrlMessage(ctx, urlMatch[0], rawText, userName, chatId, messageId);
        return;
    }

    const task: Task = { chatId, question: text, userName, messageId };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}

async function handleBtwMessage(
    deps: MessageRouterDeps,
    ctx: any,
    rawText: string,
    chatId: number,
    messageId: number,
    userName: string
) {
    const question = rawText.replace(/^\/btw\s*/i, '').trim();
    if (!question) {
        await ctx.reply('用法: `/btw <问题>`\n\n临时问答，不计入对话上下文。', { parse_mode: 'Markdown' });
        return;
    }
    const task: Task = { chatId, question, userName, messageId, skipHistory: true };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}

async function handleScheduledTaskMessage(deps: MessageRouterDeps, ctx: any, text: string, chatId: number, messageId: number) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        await ctx.reply('⚠️ 定时任务功能需要配置 GEMINI_API_KEY。', { reply_parameters: { message_id: messageId } });
        return;
    }

    const statusMsg = await deps.bot.telegram.sendMessage(
        chatId,
        '⏳ 解析定时任务...',
        { reply_parameters: { message_id: messageId } }
    );

    const result = await parseScheduledTask(text, apiKey);

    if (!result) {
        await deps.bot.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            '⚠️ 无法解析定时任务，请换个说法。\n\n支持的格式例如：\n' +
            '• 每天早上9点告诉我杭州的天气\n' +
            '• 每周一早上8点半汇总科技新闻\n' +
            '• 每两小时提醒我喝水\n' +
            '• 每天下午6点查一下比特币价格'
        ).catch(() => {});
        return;
    }

    const task = await deps.scheduledTaskManager.add(chatId, result.content, result.prompt, result.cronExpr);
    await deps.bot.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `✅ 定时任务已创建！\n\n` +
        `📌 任务: ${result.content}\n` +
        `📋 执行指令: ${result.prompt}\n` +
        `⏰ Cron: \`${result.cronExpr}\`\n` +
        `🆔 ID: ${task.id}\n\n` +
        `用 /unschedule ${task.id} 删除此任务`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
}

async function handleReminderMessage(deps: MessageRouterDeps, ctx: any, text: string, chatId: number, messageId: number) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        await ctx.reply('⚠️ 提醒功能需要配置 GEMINI_API_KEY。', { reply_parameters: { message_id: messageId } });
        return;
    }

    const statusMsg = await deps.bot.telegram.sendMessage(
        chatId,
        '⏳ 解析提醒时间...',
        { reply_parameters: { message_id: messageId } }
    );

    const result = await parseReminderTime(text, apiKey);

    if (!result || !result.content) {
        await deps.bot.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            '⚠️ 无法理解提醒时间，请换个说法试试。\n\n例如：\n' +
            '• 提醒我下周一早上9点开周会\n' +
            '• 提醒我这周五下午6点下班\n' +
            '• 30分钟后提醒我喝水\n' +
            '• 提醒我明天上午10点半打电话'
        ).catch(() => {});
        return;
    }

    const reminder = await deps.reminderManager.add(chatId, result.content, result.fireAt, result.prompt);
    const fireStr = new Date(result.fireAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    const typeLabel = result.prompt ? '🤖 定时任务' : '🔔 提醒通知';
    const detailLine = result.prompt ? `📋 任务: ${result.prompt}\n` : '';
    await deps.bot.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `✅ ${typeLabel}已设置！\n\n` +
        `📌 内容: ${result.content}\n` +
        detailLine +
        `🕐 时间: ${fireStr}\n` +
        `🆔 ID: ${reminder.id}\n\n` +
        `用 /remindcancel ${reminder.id} 取消`
    ).catch(() => {});
}
