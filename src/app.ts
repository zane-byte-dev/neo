/**
 * app.ts — Application orchestrator.
 *
 * Encapsulates adapter registration, tenant initialization, lifecycle,
 * and graceful shutdown. Platform-agnostic — adapters are registered externally.
 */

import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { ASYNC_TRIGGER_PREFIXES, WORK_DIR, AGENT_CONFIG_DIR, getAuthorizedForPlatform, getAllUsers, resolveUserId, getUserTenants } from './config.js';
import { resolveUserWorkspaceDir } from './utils/workspace.js';
import { initDb } from './services/db.js';
import { LLMClient, buildTenantSystemInstruction } from './llm/client.js';
import { ChatHistoryCache } from './services/chat-history-cache.js';
import { AsyncTaskManager } from './services/async-task-manager.js';
import { MessageQueue } from './services/message-queue.js';
import { TodoManager } from './services/todo-manager.js';
import { UserProfileManager } from './services/user-profile.js';
import { registerUserContext, getUserContext, getAllUserIds } from './services/user-context.js';
import { registerTenantContext, getTenantContext, getAllTenantKeys, getTenantContextsForUser } from './services/tool-context.js';
import { resolve as resolveUserInput, hasPending } from './services/user-input-waiter.js';
import { closeBrowser } from './services/browser-service.js';
import { setupTools } from './tools/index.js';
import { loadUserSkills, executeSkill } from './skills/index.js';
import { setupCommands, handleCommand as handleCommandFn } from './commands/index.js';
import { setupHandlers } from './core/handlers.js';
import { sendReply as sendReplyFn } from './core/reply.js';
import { processTask as processTaskFn } from './core/task-processor.js';
import { processMessage as processMessageFn } from './core/message-router.js';
import { handleUrlMessage as handleUrlMessageFn } from './handlers/url-handler.js';
import { handleAsyncTask as handleAsyncTaskFn, setupAsyncPolling as setupAsyncPollingFn } from './handlers/async-handler.js';
import { findFiles as findFilesFn } from './utils/file-search.js';
import { parseTenantKey } from './types/platform.js';
import type { TenantKey, NormalizedMessage, NormalizedCallback, PlatformAdapter, UserId } from './types/platform.js';
import type { Task } from './core/types.js';

export class App {
    private adapters = new Map<string, PlatformAdapter>();
    readonly geminiClient: LLMClient;
    private activeTaskIds = new Set<string>();
    private pendingReadMatches = new Map<string, { matches: string[]; expiry: number }>();

    constructor() {
        this.geminiClient = new LLMClient();
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
        // Initialize single shared SQLite database
        initDb();

        // Auto-discover plugins
        await setupTools();
        await setupCommands();

        // Phase 1: Initialize per-user shared contexts (workspace, profile, reminders, schedules)
        await this.initUsers();

        // Phase 2: Initialize per-tenant client contexts and wire adapters
        for (const [platform, adapter] of this.adapters) {
            const tenantKeys = getAuthorizedForPlatform(platform as any);

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

            console.log(`[${platform}] ✅ ${tenantKeys.length} tenant(s) configured.`);
        }

        // Phase 3: Initialize lifecycle per user (reminders & schedules broadcast to all tenants)
        for (const userId of getAllUserIds()) {
            await this.initUserLifecycle(userId);
        }
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
        for (const userId of getAllUserIds()) {
            const uc = getUserContext(userId);
            uc.todoManager.destroy();
        }
        this.geminiClient.close();
        closeBrowser();
        for (const [, adapter] of this.adapters) {
            await adapter.stop();
        }
    }

    // ── User initialization (shared per person) ──────────────────────────

    private async initUsers(): Promise<void> {
        const baseWorkDir = resolve(WORK_DIR || '.');
        const templateDir = AGENT_CONFIG_DIR || undefined;

        for (const [userId, entry] of getAllUsers()) {
            const workDir = resolveUserWorkspaceDir(baseWorkDir, userId);
            console.log(`[User] 📂 ${userId} workspace: ${workDir}`);

            const systemInstruction = await buildTenantSystemInstruction(workDir);
            if (systemInstruction) {
                console.log(`[User] 📜 ${userId} system instruction ready (${systemInstruction.length} chars)`);
            }

            // Per-user managers: keyed by userId for cross-client sharing
            const userProfile = new UserProfileManager(workDir);
            const todoManager = new TodoManager(userId);

            // Load Markdown skill definitions from space/{userId}/skills/
            const projectRoot = resolve('.');
            const skillRegistry = await loadUserSkills(userId, projectRoot);

            registerUserContext({
                userId,
                workDir,
                systemInstruction,
                userProfile,
                todoManager,
                skillRegistry,
            });

            console.log(`[User] ✅ ${userId} initialized (${entry.tenants.length} tenant(s))`);
        }
    }

    // ── Tenant initialization (per client) ───────────────────────────────

    private async initTenant(tenantKey: TenantKey, adapter: PlatformAdapter): Promise<void> {
        // Resolve owning user
        const userId = resolveUserId(tenantKey);
        if (!userId) {
            console.warn(`[Tenant] ⚠️  ${tenantKey} has no user mapping — skipping`);
            return;
        }
        const userCtx = getUserContext(userId);

        // Per-tenant managers: keyed by tenantKey for client isolation
        const chatHistoryCache = new ChatHistoryCache(tenantKey);
        await chatHistoryCache.init();

        // Session-to-Log: dehydrate on idle timeout
        chatHistoryCache.setOnSessionExpire(async (session: any) => {
            if (session.messages.length === 0) return;
            try {
                const { getTenantContext } = await import('./services/tool-context.js');
                const tc = getTenantContext(tenantKey);
                const skill = tc.skillRegistry.get('generate_daily_log');
                if (!skill) {
                    console.warn(`[SessionExpire] (${tenantKey}) skill generate_daily_log not found, skipping`);
                    return;
                }
                const toolCtx = {
                    tenantKey,
                    chatId: tc.chatId,
                    workDir: userCtx.workDir,
                    systemInstruction: tc.systemInstruction,
                    adapter: tc.adapter,
                    todoManager: tc.todoManager,
                    skillRegistry: tc.skillRegistry,
                };
                const result = await executeSkill(skill, {}, toolCtx);
                console.log(`[SessionExpire] (${tenantKey}) ${result.slice(0, 200)}`);
            } catch (err: any) {
                console.error(`[SessionExpire] (${tenantKey}) session-to-log failed:`, err.message);
            }
        });

        const asyncTaskManager = new AsyncTaskManager(tenantKey);
        await asyncTaskManager.init();

        const messageQueue = new MessageQueue(tenantKey);

        const { userId: platformUserId } = parseTenantKey(tenantKey);

        registerTenantContext({
            tenantKey,
            chatId: platformUserId,
            userId,
            user: userCtx,
            // Convenience: delegate to shared user context
            workDir: userCtx.workDir,
            systemInstruction: userCtx.systemInstruction,
            adapter,
            // Per-tenant (client-specific)
            chatHistoryCache,
            asyncTaskManager,
            messageQueue,
            // Shared per-user (convenience refs)
            todoManager: userCtx.todoManager,
            userProfile: userCtx.userProfile,
            skillRegistry: userCtx.skillRegistry,
        });

        console.log(`[Tenant] ✅ ${tenantKey} → user:${userId}`);
    }

    // ── Per-user lifecycle (reminders & schedules broadcast to all clients) ──

    private async initUserLifecycle(userId: UserId): Promise<void> {
        const userCtx = getUserContext(userId);
        const tenants = getTenantContextsForUser(userId);
        if (tenants.length === 0) return;

        await userCtx.userProfile.init();

        // Message queue replay (per-tenant)
        for (const tc of tenants) {
            const pending = await tc.messageQueue.init();
            if (pending.length > 0) {
                console.log(`[MessageQueue] Replaying ${pending.length} task(s) for ${tc.tenantKey}...`);
                for (const task of pending) {
                    tc.messageQueue.schedule(task, (t: Task) => this.processTask(tc.adapter, tc.tenantKey, t));
                }
                await tc.adapter.sendMessage(
                    tc.chatId,
                    `♻️ 检测到 ${pending.length} 条上次未完成的消息，已自动恢复处理。`
                ).catch(() => {});
            }
        }

        // Unified TodoManager: handles one-time reminders and recurring cron tasks
        await userCtx.todoManager.init(
            // onFire: one-time fire_at todos
            async (todo) => {
                console.log(`[Todo] Firing #${todo.id} (${todo.prompt ? 'action' : 'notification'}): ${todo.content}`);
                for (const tc of getTenantContextsForUser(userId)) {
                    if (todo.prompt) {
                        const task: Task = {
                            tenantKey: tc.tenantKey,
                            chatId: tc.chatId,
                            question: todo.prompt,
                            userName: 'reminder',
                            messageId: '0',
                        };
                        const notifyMsg = await tc.adapter.sendMessage(
                            tc.chatId,
                            `⏰ 定时任务触发：**${todo.content}**\n\n⏳ 正在执行...`,
                            { parseMode: 'markdown' },
                        ).catch(() => null);
                        if (notifyMsg) task.messageId = notifyMsg.id;
                        await tc.messageQueue.enqueue(task, (t: Task) => this.processTask(tc.adapter, tc.tenantKey, t));
                    } else {
                        await tc.adapter.sendMessage(
                            tc.chatId,
                            `⏰ **提醒:** ${todo.content}`,
                            { parseMode: 'markdown' },
                        ).catch((err: any) => console.error(`[Todo] Send to ${tc.tenantKey} failed:`, err.message));
                    }
                }
            },
            // onCron: recurring cron_expr todos
            async (todo) => {
                console.log(`[Todo] Cron #${todo.id}: ${todo.content}`);
                for (const tc of getTenantContextsForUser(userId)) {
                    try {
                        const notifyMsg = await tc.adapter.sendMessage(
                            tc.chatId,
                            `🕐 定时任务：**${todo.content}**\n\n⏳ 正在执行...`,
                            { parseMode: 'markdown' },
                        ).catch(() => null);

                        const queueTask: Task = {
                            tenantKey: tc.tenantKey,
                            chatId: tc.chatId,
                            question: todo.prompt!,
                            userName: 'scheduled-task',
                            messageId: notifyMsg?.id ?? '0',
                        };
                        await tc.messageQueue.enqueue(queueTask, (t: Task) => this.processTask(tc.adapter, tc.tenantKey, t));
                    } catch (err: any) {
                        console.error(`[Todo] Cron failed for ${tc.tenantKey}:`, err.message);
                    }
                }
            },
        );
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
                todoManager: ctx.todoManager,
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
                        workDir: ctx.workDir,
                        chatHistoryCache: ctx.chatHistoryCache,
                        asyncTaskManager: ctx.asyncTaskManager,
                        todoManager: ctx.todoManager,
                        userProfile: ctx.userProfile,
                        skillRegistry: ctx.skillRegistry,
                        pendingReadMatches: this.pendingReadMatches,
                        findFiles: (q, b, r) => findFilesFn(q, b, r),
                    },
                    { text: innerMsg.text, chatId: innerMsg.chatId, messageId: innerMsg.id, quotedText: innerMsg.quotedText },
                ),
                handleUrlMessage: (innerMsg, url) => handleUrlMessageFn(
                    {
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
            const tenantCtx = getTenantContext(cb.tenantKey);
            const workDir = tenantCtx?.workDir;
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

                const targetDir = join(workDir, 'archives', 'Library', 'Wiki');
                await fs.mkdir(targetDir, { recursive: true });
                const filePath = join(targetDir, `${title}.md`);

                const dateTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                await fs.writeFile(filePath, `# ${title}\n\n${content}\n\n---\n\n时间: ${dateTimeStr}\n`, 'utf-8');

                await adapter.editMessage(chatId, messageId, msgText, {
                    inlineKeyboard: [[{ text: `✅ 已保存 → Library/Wiki/${title}.md`, callbackData: 'saved_noop' }]],
                }).catch(() => {});
                await raw?.answerCbQuery?.('✅ 已保存到 archives/Library/Wiki/').catch(() => {});
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
