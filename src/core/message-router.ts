import { promises as fs } from 'fs';
import { resolve } from 'path';
import { parseReminderTime } from '../services/reminder-manager.js';
import { parseScheduledTask } from '../services/scheduled-task-manager.js';
import { hasPending, resolve as resolveUserInput } from '../services/user-input-waiter.js';
import { isAuthorized, GEMINI_API_KEY } from '../config.js';
import { getTenantContext } from '../services/tool-context.js';
import type { TodoManager } from '../services/todo-manager.js';
import type { PlatformAdapter, NormalizedMessage, TenantKey } from '../types/platform.js';
import type { Task } from './types.js';

interface MessageRouterDeps {
    adapter: PlatformAdapter;
    asyncTriggerPrefixes: string[];
    pendingReadMatches: Map<string, { matches: string[]; expiry: number }>;
    todoManager: TodoManager;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
    handleAsyncTask: (msg: NormalizedMessage) => Promise<void>;
    handleCommand: (msg: NormalizedMessage) => Promise<void>;
    handleUrlMessage: (msg: NormalizedMessage, url: string) => Promise<void>;
}

export async function processMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const { tenantKey, chatId, userName, id: messageId } = msg;
    const rawText = msg.text;
    const quotedText = msg.quotedText ?? null;
    const text = quotedText
        ? `[引用消息]: ${quotedText}\n\n[我的问题]: ${rawText}`
        : rawText;

    const preview = rawText.length > 50 ? `${rawText.substring(0, 50)}...` : rawText;
    console.log(`[Message] From ${userName} (${tenantKey}, MsgID: ${messageId}${quotedText ? ', replying' : ''}): ${preview}`);

    if (!isAuthorized(tenantKey)) {
        await deps.adapter.sendMessage(chatId, '⛔ Unauthorized.');
        return;
    }

    // If ask_user tool is waiting for input, route this message directly to it
    if (hasPending(chatId)) {
        resolveUserInput(chatId, rawText);
        return;
    }

    if (rawText.startsWith('/')) {
        if (rawText.startsWith('/research') || rawText.startsWith('/async')) {
            await deps.handleAsyncTask(msg);
            return;
        }
        if (rawText.startsWith('/btw')) {
            await handleBtwMessage(deps, msg);
            return;
        }
        await deps.handleCommand(msg);
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
                const tenantCtx = getTenantContext(tenantKey);
                const resolvedBase = tenantCtx.workDir;
                const relPath = absPath.slice(resolvedBase.length + 1);
                try {
                    const stat = await fs.stat(absPath);
                    if (stat.size > 100 * 1024) {
                        await deps.adapter.sendMessage(chatId, `⚠️ 文件超过 100KB（${(stat.size / 1024).toFixed(1)}KB），请缩小范围。`);
                        return;
                    }
                    const content = await fs.readFile(absPath, 'utf8');
                    const MAX_MSG = 4000;
                    const header = `📄 ${relPath}\n\n`;
                    if (header.length + content.length <= MAX_MSG) {
                        await deps.adapter.sendMessage(chatId, header + content);
                    } else {
                        const chunks: string[] = [];
                        for (let i = 0; i < content.length; i += MAX_MSG - header.length) {
                            chunks.push(content.slice(i, i + MAX_MSG - header.length));
                        }
                        await deps.adapter.sendMessage(chatId, `📄 ${relPath} (${chunks.length} 段)\n\n${chunks[0]}`);
                        for (let i = 1; i < chunks.length; i++) {
                            await deps.adapter.sendMessage(chatId, chunks[i]).catch(() => {});
                        }
                    }
                } catch (err: any) {
                    await deps.adapter.sendMessage(chatId, `❌ 无法读取文件: ${err.message}`);
                }
                return;
            }
        }
    }

    if (deps.asyncTriggerPrefixes.some((prefix) => rawText.startsWith(prefix))) {
        await deps.handleAsyncTask(msg);
        return;
    }

    const isScheduleIntent = /每(天|日|周|月|小时|隔|个工作日)/.test(rawText) ||
        /定期|每\d+(分钟|小时)/.test(rawText);
    if (isScheduleIntent) {
        await handleScheduledTaskMessage(deps, msg);
        return;
    }

    const isReminderIntent = rawText.includes('提醒我') || /^\d+\s*(分钟|小时|天)后/.test(rawText);
    if (isReminderIntent) {
        await handleReminderMessage(deps, msg);
        return;
    }

    const urlMatch = rawText.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
        await deps.handleUrlMessage(msg, urlMatch[0]);
        return;
    }

    const task: Task = { tenantKey, chatId, question: text, userName, messageId };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}

async function handleBtwMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const question = msg.text.replace(/^\/btw\s*/i, '').trim();
    if (!question) {
        await deps.adapter.sendMessage(msg.chatId, '用法: `/btw <问题>`\n\n临时问答，不计入对话上下文。', { parseMode: 'markdown' });
        return;
    }
    const task: Task = { tenantKey: msg.tenantKey, chatId: msg.chatId, question, userName: msg.userName, messageId: msg.id, skipHistory: true };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}

async function handleScheduledTaskMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const { chatId, id: messageId, text, tenantKey } = msg;
    const apiKey = GEMINI_API_KEY;
    if (!apiKey) {
        await deps.adapter.sendMessage(chatId, '⚠️ 定时任务功能需要配置 GEMINI_API_KEY。', { replyToId: messageId });
        return;
    }

    const statusMsg = await deps.adapter.sendMessage(chatId, '⏳ 解析定时任务...', { replyToId: messageId });

    const result = await parseScheduledTask(text, apiKey);

    if (!result) {
        await deps.adapter.editMessage(chatId, statusMsg.id,
            '⚠️ 无法解析定时任务，请换个说法。\n\n支持的格式例如：\n' +
            '• 每天早上9点告诉我杭州的天气\n' +
            '• 每周一早上8点半汇总科技新闻\n' +
            '• 每两小时提醒我喝水\n' +
            '• 每天下午6点查一下比特币价格'
        ).catch(() => {});
        return;
    }

    const task = deps.todoManager.add({ content: result.content, prompt: result.prompt, cronExpr: result.cronExpr });
    await deps.adapter.editMessage(chatId, statusMsg.id,
        `✅ 定时任务已创建！\n\n` +
        `📌 任务: ${result.content}\n` +
        `📋 执行指令: ${result.prompt}\n` +
        `⏰ Cron: \`${result.cronExpr}\`\n` +
        `🆔 ID: ${task.id}\n\n` +
        `用 /unschedule ${task.id} 删除此任务`,
        { parseMode: 'markdown' },
    ).catch(() => {});
}

async function handleReminderMessage(deps: MessageRouterDeps, msg: NormalizedMessage) {
    const { chatId, id: messageId, text } = msg;
    const apiKey = GEMINI_API_KEY;
    if (!apiKey) {
        await deps.adapter.sendMessage(chatId, '⚠️ 提醒功能需要配置 GEMINI_API_KEY。', { replyToId: messageId });
        return;
    }

    const statusMsg = await deps.adapter.sendMessage(chatId, '⏳ 解析提醒时间...', { replyToId: messageId });

    const result = await parseReminderTime(text, apiKey);

    if (!result || !result.content) {
        await deps.adapter.editMessage(chatId, statusMsg.id,
            '⚠️ 无法理解提醒时间，请换个说法试试。\n\n例如：\n' +
            '• 提醒我下周一早上9点开周会\n' +
            '• 提醒我这周五下午6点下班\n' +
            '• 30分钟后提醒我喝水\n' +
            '• 提醒我明天上午10点半打电话'
        ).catch(() => {});
        return;
    }

    const reminder = deps.todoManager.add({ content: result.content, fireAt: result.fireAt, prompt: result.prompt });
    const fireStr = new Date(result.fireAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    const typeLabel = result.prompt ? '🤖 定时任务' : '🔔 提醒通知';
    const detailLine = result.prompt ? `📋 任务: ${result.prompt}\n` : '';
    await deps.adapter.editMessage(chatId, statusMsg.id,
        `✅ ${typeLabel}已设置！\n\n` +
        `📌 内容: ${result.content}\n` +
        detailLine +
        `🕐 时间: ${fireStr}\n` +
        `🆔 ID: ${reminder.id}\n\n` +
        `用 /remindcancel ${reminder.id} 取消`
    ).catch(() => {});
}
