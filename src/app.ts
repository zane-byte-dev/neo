/**
 * app.ts — Application orchestrator.
 *
 * Encapsulates adapter registration, tenant initialization, lifecycle,
 * and graceful shutdown. Platform-agnostic — adapters are registered externally.
 */

import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { ASYNC_TRIGGER_PREFIXES, CACHE_DIR, getAuthorizedForPlatform } from './config.js';
import { GeminiClient } from './services/gemini-client.js';
import { ChatHistoryCache } from './services/chat-history-cache.js';
import { AsyncTaskManager } from './services/async-task-manager.js';
import { MessageQueue } from './services/message-queue.js';
import { ReminderManager } from './services/reminder-manager.js';
import { ScheduledTaskManager } from './services/scheduled-task-manager.js';
import { UserProfileManager } from './services/user-profile.js';
import { registerTenantContext, getTenantContext, getAllTenantKeys } from './services/tool-context.js';
import { resolve as resolveUserInput, hasPending } from './services/user-input-waiter.js';
import { closeBrowser } from './services/browser-service.js';
import { setupTools } from './tools/index.js';
import { setupCommands, handleCommand as handleCommandFn } from './commands/index.js';
import { setupCronJobs } from './crons/index.js';
import { setupHandlers } from './core/handlers.js';
import { initLifecycle } from './core/lifecycle.js';
import { sendReply as sendReplyFn } from './core/reply.js';
import { processTask as processTaskFn } from './core/task-processor.js';
import { processMessage as processMessageFn } from './core/message-router.js';
import { handleUrlMessage as handleUrlMessageFn } from './handlers/url-handler.js';
import { handleAsyncTask as handleAsyncTaskFn, setupAsyncPolling as setupAsyncPollingFn } from './handlers/async-handler.js';
import { findFiles as findFilesFn } from './utils/file-search.js';
import { parseTenantKey } from './types/platform.js';
import type { TenantKey, NormalizedMessage, NormalizedCallback, PlatformAdapter } from './types/platform.js';
import type { Task } from './core/types.js';

export class App {
    private adapters = new Map<string, PlatformAdapter>();
    private geminiClient: GeminiClient;
    private activeTaskIds = new Set<string>();
    private pendingReadMatches = new Map<string, { matches: string[]; expiry: number }>();

    constructor() {
        this.geminiClient = new GeminiClient();
    }

    // ── Adapter registration ─────────────────────────────────────────────

    registerAdapter(adapter: PlatformAdapter): void {
        this.adapters.set(adapter.platform, adapter);
    }

    getAdapter(platform: string): PlatformAdapter {
        const adapter = this.adapters.get(platform);
        if (!adapter) throw new Error(`[App] Adapter not registered: ${platform}`);
        return adapter;
    }

    // ── Bootstrap ────────────────────────────────────────────────────────

    async init(): Promise<void> {
        // Auto-discover plugins
        await setupTools();
        await setupCommands();

        // Initialize tenants per adapter
        for (const [platform, adapter] of this.adapters) {
            const tenantKeys = getAuthorizedForPlatform(platform as any);

            // Legacy cache migration for first platform
            if (platform === 'telegram') {
                await this.migrateLegacyCache(tenantKeys);
            }

            for (const tk of tenantKeys) {
                await this.initTenant(tk, adapter);
            }

            // Wire event handlers
            setupHandlers({
                adapter,
                processMessage: (msg) => this.processMessage(adapter, msg.tenantKey, msg),
                handleCallbackQuery: (cb) => this.handleCallbackQuery(adapter, cb),
            });

            // Setup async polling per tenant
            for (const tk of tenantKeys) {
                const ctx = getTenantContext(tk);
                setupAsyncPollingFn({
                    asyncTaskManager: ctx.asyncTaskManager,
                    geminiClient: this.geminiClient,
                    sendReply: (cId, text, retries, rId) => this.sendReply(adapter, cId, text, retries, rId),
                    activeTaskIds: this.activeTaskIds,
                });
            }

            // Initialize lifecycle per tenant
            for (const tk of tenantKeys) {
                const ctx = getTenantContext(tk);
                await initLifecycle({
                    adapter,
                    tenantKey: tk,
                    chatId: ctx.chatId,
                    userProfile: ctx.userProfile,
                    reminderManager: ctx.reminderManager,
                    scheduledTaskManager: ctx.scheduledTaskManager,
                    messageQueue: ctx.messageQueue,
                    processTask: (task) => this.processTask(adapter, tk, task),
                });
            }

            console.log(`[${platform}] ✅ ${tenantKeys.length} tenant(s) configured.`);
        }

        // Cron jobs operate across all tenants
        setupCronJobs({
            tenantKeys: getAllTenantKeys(),
            sendReply: async (tenantKey, text) => {
                const ctx = getTenantContext(tenantKey);
                await this.sendReply(ctx.adapter, ctx.chatId, text);
            },
        });
    }

    // ── Start / Stop ─────────────────────────────────────────────────────

    async start(): Promise<void> {
        for (const [, adapter] of this.adapters) {
            await adapter.start();
        }

        console.log(`🤖 Bot started. Adapters: ${[...this.adapters.keys()].join(', ')}`);
        console.log(`🛠  Gemini Client enabled: ${this.geminiClient.isEnabled()}`);
    }

    async shutdown(): Promise<void> {
        const allKeys = getAllTenantKeys();
        for (const tk of allKeys) {
            const ctx = getTenantContext(tk);
            ctx.reminderManager.destroy();
            ctx.scheduledTaskManager.destroy();
        }
        this.geminiClient.close();
        closeBrowser();
        for (const [, adapter] of this.adapters) {
            await adapter.stop();
        }
    }

    // ── Tenant initialization ────────────────────────────────────────────

    private async initTenant(tenantKey: TenantKey, adapter: PlatformAdapter): Promise<void> {
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

    // ── Legacy cache migration ───────────────────────────────────────────

    private async migrateLegacyCache(tenantKeys: TenantKey[]): Promise<void> {
        const legacyFiles = [
            'chat_history.json', 'async_tasks.json', 'message_queue.json',
            'reminders.json', 'scheduled_tasks.json', 'todos.json', 'user_profile.json',
        ];

        let hasLegacy = false;
        for (const f of legacyFiles) {
            try {
                await fs.access(join(CACHE_DIR, f));
                hasLegacy = true;
                break;
            } catch { /* not found */ }
        }
        if (!hasLegacy) return;

        const firstTk = tenantKeys[0];
        if (!firstTk) return;

        const targetDir = join(CACHE_DIR, firstTk.replace(':', '_'));
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

    // ── Message processing pipeline ──────────────────────────────────────

    private sendReply(adapter: PlatformAdapter, chatId: string, text: string, retries: number = 2, replyToMessageId?: string) {
        return sendReplyFn(adapter, chatId, text, retries, replyToMessageId);
    }

    private processTask(adapter: PlatformAdapter, tenantKey: TenantKey, task: Task) {
        const ctx = getTenantContext(tenantKey);
        return processTaskFn(
            {
                adapter,
                geminiClient: this.geminiClient,
                chatHistoryCache: ctx.chatHistoryCache,
                userProfile: ctx.userProfile,
                sendReply: (cId, text, retries, replyToMsgId) => this.sendReply(adapter, cId, text, retries, replyToMsgId),
            },
            task,
        );
    }

    private processMessage(adapter: PlatformAdapter, tenantKey: TenantKey, msg: NormalizedMessage) {
        const ctx = getTenantContext(tenantKey);
        return processMessageFn(
            {
                adapter,
                asyncTriggerPrefixes: ASYNC_TRIGGER_PREFIXES,
                pendingReadMatches: this.pendingReadMatches,
                scheduledTaskManager: ctx.scheduledTaskManager,
                reminderManager: ctx.reminderManager,
                messageQueue: ctx.messageQueue,
                processTask: (task) => this.processTask(adapter, tenantKey, task),
                handleAsyncTask: (innerMsg) => handleAsyncTaskFn(
                    {
                        asyncTaskManager: ctx.asyncTaskManager,
                        geminiClient: this.geminiClient,
                        sendReply: (cId, text, retries, rId) => this.sendReply(adapter, cId, text, retries, rId),
                        activeTaskIds: this.activeTaskIds,
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
                        pendingReadMatches: this.pendingReadMatches,
                        findFiles: (q, b, r) => findFilesFn(q, b, r),
                    },
                    { text: innerMsg.text, chatId: innerMsg.chatId, messageId: innerMsg.id, quotedText: innerMsg.quotedText },
                ),
                handleUrlMessage: (innerMsg, url) => handleUrlMessageFn(
                    {
                        adapter,
                        messageQueue: ctx.messageQueue,
                        processTask: (task) => this.processTask(adapter, tenantKey, task),
                    },
                    innerMsg,
                    url,
                ),
            },
            msg,
        );
    }

    private async handleCallbackQuery(adapter: PlatformAdapter, cb: NormalizedCallback) {
        const { data, chatId, messageId } = cb;

        // ask_user inline keyboard response
        if (data.startsWith('ask_user:')) {
            const choice = data.slice('ask_user:'.length);
            if (hasPending(chatId)) {
                resolveUserInput(chatId, choice);
                await adapter.editMessage(chatId, messageId, '', {
                    inlineKeyboard: [],
                }).catch(() => {});
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
}
