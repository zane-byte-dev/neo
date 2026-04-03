#!/usr/bin/env node

import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { BOT_COMMANDS, ASYNC_TRIGGER_PREFIXES, CACHE_DIR, AUTHORIZED_USERS, getAuthorizedForPlatform } from './config.js';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { setupLogger } from './utils/logger.js';
import { AsyncTaskManager } from './lib/async-task-manager.js';
import { MessageQueue } from './lib/message-queue.js';
import { ReminderManager } from './lib/reminder-manager.js';
import { ScheduledTaskManager } from './lib/scheduled-task-manager.js';
import { UserProfileManager } from './lib/user-profile.js';
import { setupTools } from './tools/index.js';
import { setupCommands, handleCommand as handleCommandFn } from './commands/index.js';
import { registerTenantContext, getTenantContext, getAllTenantKeys } from './lib/tool-context.js';
import { resolve as resolveUserInput, hasPending } from './lib/user-input-waiter.js';
import { closeBrowser } from './lib/browser-service.js';
import { setupCronJobs } from './crons/index.js';
import { setupHandlers } from './bot/handlers.js';
import { initLifecycle } from './bot/lifecycle.js';
import { sendReply as sendReplyFn } from './bot/reply.js';
import { processTask as processTaskFn } from './bot/task-processor.js';
import { findFiles as findFilesFn } from './utils/file-search.js';
import { processMessage as processMessageFn } from './bot/message-router.js';
import { handleUrlMessage as handleUrlMessageFn } from './bot/url-handler.js';
import {
    processPhotoMessage as processPhotoMessageFn,
    processVoiceMessage as processVoiceMessageFn,
    processDocumentMessage as processDocumentMessageFn,
} from './bot/media-handler.js';
import { handleAsyncTask as handleAsyncTaskFn, setupAsyncPolling as setupAsyncPollingFn } from './bot/async-handler.js';
import { TelegramAdapter } from './adapters/telegram-adapter.js';
import { parseTenantKey } from './types/platform.js';
import type { TenantKey, NormalizedMessage, NormalizedCallback, PlatformAdapter } from './types/platform.js';
import type { Task } from './bot/types.js';


// Initialize Logger
setupLogger();

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN missing.');
    process.exit(1);
}

if (AUTHORIZED_USERS.size === 0) {
    console.error('❌ No authorized users. Set AUTHORIZED_USERS or TELEGRAM_CHAT_ID.');
    process.exit(1);
}

// Auto-discover and register pluggable tools & commands
await setupTools();
await setupCommands();

// Initialize Gemini client (shared across tenants)
const geminiClient = new GeminiClient();

// ── Legacy data migration ────────────────────────────────────────────────────

/**
 * Migrate old single-tenant cache files into the first Telegram tenant's subdirectory.
 * Only runs once — if legacy files exist at cache root but no tenant dirs have been created yet.
 */
async function migrateLegacyCache(): Promise<void> {
    const legacyFiles = [
        'chat_history.json', 'async_tasks.json', 'message_queue.json',
        'reminders.json', 'scheduled_tasks.json', 'todos.json', 'user_profile.json',
    ];

    // Check if any legacy file exists at cache root
    let hasLegacy = false;
    for (const f of legacyFiles) {
        try {
            await fs.access(join(CACHE_DIR, f));
            hasLegacy = true;
            break;
        } catch { /* not found */ }
    }

    if (!hasLegacy) return;

    // Pick the first (usually only) Telegram tenant as migration target
    const firstTk = telegramTenantKeys[0];
    if (!firstTk) return;

    const targetDir = join(CACHE_DIR, firstTk.replace(':', '_'));

    // If target dir already has files, skip — migration already done
    try {
        const entries = await fs.readdir(targetDir);
        if (entries.length > 0) return;
    } catch { /* dir doesn't exist yet, proceed */ }

    await fs.mkdir(targetDir, { recursive: true });

    let migrated = 0;
    for (const f of legacyFiles) {
        const src = join(CACHE_DIR, f);
        const dest = join(targetDir, f);
        try {
            await fs.copyFile(src, dest);
            migrated++;
        } catch { /* file doesn't exist, skip */ }
    }

    if (migrated > 0) {
        console.log(`[Migration] Moved ${migrated} cache files from ${CACHE_DIR}/ → ${targetDir}/`);
    }
}

// ── Per-tenant initialization ────────────────────────────────────────────────

async function initTenant(tenantKey: TenantKey, adapter: PlatformAdapter): Promise<void> {
    const tenantCacheDir = join(CACHE_DIR, tenantKey.replace(':', '_'));
    await fs.mkdir(tenantCacheDir, { recursive: true });

    const chatHistoryCache = new ChatHistoryCache(tenantCacheDir);
    await chatHistoryCache.init();

    // Session-to-Log: dehydrate on idle timeout
    chatHistoryCache.setOnSessionExpire(async (session: any) => {
        if (session.messages.length === 0) return;
        try {
            const { generateDailyLogTool } = await import('./tools/generate-daily-log.js');
            const result = await generateDailyLogTool.handler({}, '');
            console.log(`[SessionExpire] (${tenantKey}) ${result}`);
        } catch (err: any) {
            console.error(`[SessionExpire] (${tenantKey}) session-to-log failed:`, err.message);
        }
    });

    const asyncTaskManager = new AsyncTaskManager(tenantCacheDir);
    await asyncTaskManager.init();

    const messageQueue = new MessageQueue(tenantCacheDir);
    const reminderManager = new ReminderManager(tenantCacheDir);
    const scheduledTaskManager = new ScheduledTaskManager(tenantCacheDir);
    const userProfile = new UserProfileManager(tenantCacheDir);

    const { userId } = parseTenantKey(tenantKey);

    registerTenantContext({
        tenantKey,
        chatId: userId,
        adapter,
        scheduledTaskManager,
        reminderManager,
        chatHistoryCache,
        userProfile,
        asyncTaskManager,
        messageQueue,
        cacheDir: tenantCacheDir,
    });

    console.log(`[Tenant] ✅ ${tenantKey} initialized (cache: ${tenantCacheDir})`);
}

// ── Shared processing functions ──────────────────────────────────────────────

const activeTaskIds = new Set<string>();
const pendingReadMatches = new Map<string, { matches: string[]; expiry: number }>();

function sendReply(adapter: PlatformAdapter, chatId: string, text: string, retries: number = 2, replyToMessageId?: string) {
    return sendReplyFn(adapter, chatId, text, retries, replyToMessageId);
}

function processTask(adapter: PlatformAdapter, tenantKey: TenantKey, task: Task) {
    const ctx = getTenantContext(tenantKey);
    return processTaskFn(
        {
            adapter,
            geminiClient,
            chatHistoryCache: ctx.chatHistoryCache,
            userProfile: ctx.userProfile,
            sendReply: (cId, text, retries, replyToMsgId) => sendReply(adapter, cId, text, retries, replyToMsgId),
        },
        task,
    );
}

function processMessage(adapter: PlatformAdapter, tenantKey: TenantKey, msg: NormalizedMessage) {
    const ctx = getTenantContext(tenantKey);
    return processMessageFn(
        {
            adapter,
            asyncTriggerPrefixes: ASYNC_TRIGGER_PREFIXES,
            pendingReadMatches,
            scheduledTaskManager: ctx.scheduledTaskManager,
            reminderManager: ctx.reminderManager,
            messageQueue: ctx.messageQueue,
            processTask: (task) => processTask(adapter, tenantKey, task),
            handleAsyncTask: (innerMsg) => handleAsyncTaskFn(
                {
                    asyncTaskManager: ctx.asyncTaskManager,
                    geminiClient,
                    sendReply: (cId, text, retries, rId) => sendReply(adapter, cId, text, retries, rId),
                    activeTaskIds,
                },
                innerMsg,
            ),
            handleCommand: (innerMsg) => handleCommandFn(
                {
                    adapter,
                    tenantKey,
                    chatId: innerMsg.chatId,
                    chatHistoryCache: ctx.chatHistoryCache,
                    asyncTaskManager: ctx.asyncTaskManager,
                    reminderManager: ctx.reminderManager,
                    scheduledTaskManager: ctx.scheduledTaskManager,
                    userProfile: ctx.userProfile,
                    pendingReadMatches,
                    findFiles: (q, b, r) => findFilesFn(q, b, r),
                },
                { text: innerMsg.text, chatId: innerMsg.chatId, messageId: innerMsg.id, quotedText: innerMsg.quotedText },
            ),
            handleUrlMessage: (innerMsg, url) => handleUrlMessageFn(
                {
                    adapter,
                    messageQueue: ctx.messageQueue,
                    processTask: (task) => processTask(adapter, tenantKey, task),
                },
                innerMsg,
                url,
            ),
        },
        msg,
    );
}

async function handleCallbackQuery(adapter: PlatformAdapter, cb: NormalizedCallback) {
    const { data, chatId, messageId } = cb;

    // ask_user inline keyboard response
    if (data.startsWith('ask_user:')) {
        const choice = data.slice('ask_user:'.length);
        if (hasPending(chatId)) {
            resolveUserInput(chatId, choice);
            await adapter.editMessage(chatId, messageId, '', {
                inlineKeyboard: [],
            }).catch(() => {});
            // For Telegram we need answerCbQuery through the raw context
            if (cb._raw && typeof (cb._raw as any).answerCbQuery === 'function') {
                await (cb._raw as any).answerCbQuery(`已选择：${choice}`).catch(() => {});
            }
        } else {
            if (cb._raw && typeof (cb._raw as any).answerCbQuery === 'function') {
                await (cb._raw as any).answerCbQuery('已超时或无待处理问题').catch(() => {});
            }
        }
        return;
    }

    if (data === 'save_lib') {
        const workDir = process.env.WORK_DIR;
        const raw = cb._raw as any;
        if (!workDir) {
            await raw?.answerCbQuery?.('⚠️ WORK_DIR 未配置').catch(() => {});
            return;
        }

        const msgText: string = raw?.callbackQuery?.message?.text || '';
        const content = msgText.replace(/^(?:\[\d+\/\d+\]\n)?🤖 inkClaw \(\d{2}:\d{2}\)\n\n/, '');

        if (!content.trim()) {
            await raw?.answerCbQuery?.('❌ 消息内容为空').catch(() => {});
            return;
        }

        try {
            const now = new Date();
            const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
            const timeStr = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).replace(':', '');
            const title = `saved-${dateStr}-${timeStr}`;

            const targetDir = join(resolve(workDir), '3-Library', 'Wiki');
            await fs.mkdir(targetDir, { recursive: true });
            const filePath = join(targetDir, `${title}.md`);

            const dateTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            await fs.writeFile(filePath, `# ${title}\n\n${content}\n\n---\n\n时间: ${dateTimeStr}\n`, 'utf-8');

            await adapter.editMessage(chatId, messageId, msgText, {
                inlineKeyboard: [[{ text: `✅ 已保存 → Wiki/${title}.md`, callbackData: 'saved_noop' }]],
            }).catch(() => {});
            await raw?.answerCbQuery?.('✅ 已保存到 3-Library/Wiki/').catch(() => {});
        } catch (err: any) {
            console.error('[SaveCallback] Error:', err.message);
            await raw?.answerCbQuery?.('❌ 保存失败: ' + err.message).catch(() => {});
        }
    } else if (data === 'saved_noop') {
        if (cb._raw && typeof (cb._raw as any).answerCbQuery === 'function') {
            await (cb._raw as any).answerCbQuery('已保存过了').catch(() => {});
        }
    }
}

// ── Telegram bootstrap ───────────────────────────────────────────────────────

const telegramAdapter = new TelegramAdapter(BOT_TOKEN);

// Initialize all Telegram tenants
const telegramTenantKeys = getAuthorizedForPlatform('telegram');
await migrateLegacyCache();
for (const tk of telegramTenantKeys) {
    await initTenant(tk, telegramAdapter);
}

// Wire event handlers
setupHandlers({
    adapter: telegramAdapter,
    processMessage: (msg) => processMessage(telegramAdapter, msg.tenantKey, msg),
    handleCallbackQuery: (cb) => handleCallbackQuery(telegramAdapter, cb),
});

// Setup cron jobs
setupCronJobs({
    tenantKeys: getAllTenantKeys(),
    sendReply: async (tenantKey, text) => {
        const ctx = getTenantContext(tenantKey);
        await sendReply(ctx.adapter, ctx.chatId, text);
    },
});

// Setup async polling for each tenant
for (const tk of telegramTenantKeys) {
    const ctx = getTenantContext(tk);
    setupAsyncPollingFn({
        asyncTaskManager: ctx.asyncTaskManager,
        geminiClient,
        sendReply: (cId, text, retries, rId) => sendReply(telegramAdapter, cId, text, retries, rId),
        activeTaskIds,
    });
}

// Initialize lifecycle for each tenant (profile, reminders, scheduled tasks, queue replay)
for (const tk of telegramTenantKeys) {
    const ctx = getTenantContext(tk);
    await initLifecycle({
        adapter: telegramAdapter,
        tenantKey: tk,
        chatId: ctx.chatId,
        userProfile: ctx.userProfile,
        reminderManager: ctx.reminderManager,
        scheduledTaskManager: ctx.scheduledTaskManager,
        messageQueue: ctx.messageQueue,
        processTask: (task) => processTask(telegramAdapter, tk, task),
    });
}

// ── Launch ───────────────────────────────────────────────────────────────────

console.log(`🤖 Bot started. Authorized tenants: ${[...AUTHORIZED_USERS].join(', ')}`);
console.log(`🛠  Gemini Client enabled: ${geminiClient.isEnabled()}`);

// Register Telegram command menu
telegramAdapter.setCommands(BOT_COMMANDS)
    .then(() => console.log('[System] Telegram commands registered.'))
    .catch((err: any) => console.error('[System] Failed to register commands:', err));

// Send startup message to all Telegram tenants
const timeStr = new Date().toLocaleString('zh-CN');
for (const tk of telegramTenantKeys) {
    const ctx = getTenantContext(tk);
    telegramAdapter.sendMessage(
        ctx.chatId,
        `🤖 **inkClaw** 已于 ${timeStr} 启动/重启。\n` +
        `✅ 网关已上线\n` +
        `✅ 引擎状态: ${process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'} (Direct API + Agentic Loop)`,
        { parseMode: 'markdown' },
    ).catch((err: any) => console.error(`[Startup Message Failed] ${tk}:`, err));
}

await telegramAdapter.start();

// Graceful shutdown
const shutdown = (signal: string) => {
    const allKeys = getAllTenantKeys();
    for (const tk of allKeys) {
        const ctx = getTenantContext(tk);
        ctx.reminderManager.destroy();
        ctx.scheduledTaskManager.destroy();
    }
    geminiClient.close();
    closeBrowser();
    telegramAdapter.stop();
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
