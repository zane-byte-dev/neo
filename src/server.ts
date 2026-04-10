/**
 * server.ts — CoreServer: central application hub.
 *
 * Architecture: Server + Client model.
 *   - CoreServer owns the message pipeline, all services, and the HTTP layer
 *   - Platform clients (TelegramClient, FeishuClient) are thin ingress/egress
 *     wrappers that call server.handleMessage() / server.handleCallbackQuery()
 *   - Web UI is served directly by CoreServer (Koa HTTP + SSE)
 *
 * Previously split across app.ts (orchestration) and platform/web/web-adapter.ts
 * (HTTP routes). Both are now unified here.
 */

import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { PassThrough } from 'stream';
import { join, resolve, dirname } from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import {
    ASYNC_TRIGGER_PREFIXES,
    WORK_DIR,
    getAuthorizedForPlatform,
    resolveUserId,
    GEMINI_API_KEY,
    resolveUserIdByWebToken,
    hasWebTokens,
} from './config.js';
import { resolveUserWorkspaceDir } from './utils/workspace.js';
import { initDb } from './services/db.js';
import { LLMClient, buildTenantSystemInstruction } from './llm/client.js';
import { ChatHistoryCache } from './services/chat-history-cache.js';
import { AsyncTaskManager } from './services/async-task-manager.js';
import { MessageQueue } from './services/message-queue.js';
import { initTodoScope } from './services/todo-service.js';
import { UserProfileManager } from './services/user-profile.js';
import { registerUserContext, getUserContext, hasUserContext, getAllUserIds } from './services/user-context.js';
import {
    registerTenantContext,
    getTenantContext,
    getTenantContextsForUser,
    hasTenantContext,
} from './services/tool-context.js';
import { resolve as resolveUserInput, hasPending } from './services/user-input-waiter.js';
import { closeBrowser } from './services/browser-service.js';
import { setupTools } from './tools/index.js';
import { loadUserSkills } from './skills/index.js';
import { setupCommands, handleCommand as handleCommandFn } from './commands/index.js';
import { sendReply as sendReplyFn } from './core/reply.js';
import { processTask as processTaskFn } from './core/task-processor.js';
import { processMessage as processMessageFn } from './core/message-router.js';
import { handleUrlMessage as handleUrlMessageFn } from './handlers/url-handler.js';
import { handleAsyncTask as handleAsyncTaskFn, setupAsyncPolling as setupAsyncPollingFn } from './handlers/async-handler.js';
import { findFiles as findFilesFn } from './utils/file-search.js';
import { nbList, nbSearch, nbGet, nbCreate, nbUpdate, nbDelete } from './services/notebook-service.js';
import { noteList, noteStats, noteTags, noteCreate, noteDelete } from './services/note-service.js';
import { todoList, todoAdd, todoPatch, todoDelete } from './services/todo-service.js';
import { geminiGenerate } from './llm/providers/gemini/index.js';
import { parseTenantKey } from './types/platform.js';
import type {
    TenantKey,
    NormalizedMessage,
    NormalizedCallback,
    PlatformAdapter,
    UserId,
} from './types/platform.js';
import type { ToolContext } from './llm/types.js';
import type { Task } from './core/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);

export class CoreServer {
    /** Registered platform clients (telegram, feishu, …) */
    private clients = new Map<string, PlatformAdapter>();

    readonly llm: LLMClient;

    private activeTaskIds = new Set<string>();
    private pendingReadMatches = new Map<string, { matches: string[]; expiry: number }>();
    private _userInitPromises = new Map<string, Promise<void>>();
    private _tenantInitPromises = new Map<TenantKey, Promise<void>>();

    /** SSE push streams for web clients: userId → active PassThrough */
    private activeStreams = new Map<string, PassThrough>();

    private httpServer?: ReturnType<Koa['listen']>;

    constructor() {
        this.llm = new LLMClient();
    }

    // ── Client registration ──────────────────────────────────────────────

    registerClient(client: PlatformAdapter): void {
        this.clients.set(client.platform, client);
    }

    getClient(platform: string): PlatformAdapter {
        const c = this.clients.get(platform);
        if (!c) throw new Error(`[CoreServer] Client not registered: ${platform}`);
        return c;
    }

    // ── Bootstrap ────────────────────────────────────────────────────────

    async init(): Promise<void> {
        initDb();
        await setupTools();
        await setupCommands();

        // Init tenants — user contexts are lazily created on first tenant reference
        for (const [platform, client] of this.clients) {
            const tenantKeys = getAuthorizedForPlatform(platform as any);
            for (const tk of tenantKeys) {
                await this._ensureTenantContext(tk, client);
                this._setupAsyncPolling(tk, client);
            }
            console.log(`[${platform}] ✅ ${tenantKeys.length} tenant(s) configured.`);
        }

        // Web tenants (synthesized egress via SSE)
        await this._initWebTenants();

        // Per-user lifecycle (reminders, schedules, message queue replay)
        for (const userId of getAllUserIds()) {
            await this._initUserLifecycle(userId);
        }
    }

    // ── Start / Stop ─────────────────────────────────────────────────────

    async start(): Promise<void> {
        // Start HTTP server if web is enabled
        if (process.env.WEB_PORT ?? process.env.WEB_ENABLED) {
            const koa = this._buildKoa();
            this.httpServer = koa.listen(WEB_PORT, () => {
                console.log(`[CoreServer] 🌐 http://localhost:${WEB_PORT}`);
                if (!hasWebTokens()) {
                    console.warn('[CoreServer] ⚠️  No webToken in users.json — web UI is unprotected!');
                }
            });
        }

        // Start platform clients
        for (const [, client] of this.clients) {
            await client.start();
        }

        console.log(`🤖 CoreServer started. Clients: ${[...this.clients.keys()].join(', ')}`);
        console.log(`🛠  LLM enabled: ${this.llm.isEnabled()}`);
    }

    async shutdown(): Promise<void> {
        for (const userId of getAllUserIds()) {
            getUserContext(userId).todoManager.destroy();
        }
        this.llm.close();
        closeBrowser();
        for (const [, client] of this.clients) {
            await client.stop();
        }
        await new Promise<void>((res) => {
            if (this.httpServer) this.httpServer.close(() => res());
            else res();
        });
    }

    // ── Public API (called by platform clients for ingress) ──────────────

    async handleMessage(msg: NormalizedMessage): Promise<void> {
        const { platform } = parseTenantKey(msg.tenantKey);
        const client = this.clients.get(platform);
        if (!client) {
            console.warn(`[CoreServer] No client for platform: ${platform}`);
            return;
        }
        return this._processMessage(client, msg.tenantKey, msg);
    }

    // ── Web SSE registry ─────────────────────────────────────────────────

    registerWebStream(userId: string, stream: PassThrough): void {
        this.activeStreams.set(userId, stream);
    }

    unregisterWebStream(userId: string): void {
        this.activeStreams.delete(userId);
    }

    sendWebPush(userId: string, text: string): void {
        const stream = this.activeStreams.get(userId);
        if (stream && !stream.destroyed) {
            stream.write(`data: ${JSON.stringify({ type: 'push', text })}\n\n`);
        }
    }

    // ── Context initialization (lazy, idempotent) ─────────────────────────

    /** Ensure user context exists. Promise-cached — safe to call concurrently or repeatedly. */
    private _ensureUserContext(userId: UserId): Promise<void> {
        if (!this._userInitPromises.has(userId)) {
            this._userInitPromises.set(userId, this._doInitUserContext(userId));
        }
        return this._userInitPromises.get(userId)!;
    }

    private async _doInitUserContext(userId: UserId): Promise<void> {
        if (hasUserContext(userId)) return;
        const baseWorkDir = resolve(WORK_DIR || '.');
        const workDir = resolveUserWorkspaceDir(baseWorkDir, userId);
        console.log(`[User] 📂 ${userId} workspace: ${workDir}`);

        const systemInstruction = await buildTenantSystemInstruction(workDir);
        if (systemInstruction) {
            console.log(`[User] 📜 ${userId} system instruction ready (${systemInstruction.length} chars)`);
        }

        const userProfile = new UserProfileManager(workDir);
        const todoManager = initTodoScope(userId);
        const skillRegistry = await loadUserSkills(userId, resolve('.'));
        const chatHistoryCache = new ChatHistoryCache(userId);
        await chatHistoryCache.init();

        registerUserContext({ userId, workDir, systemInstruction, userProfile, todoManager, skillRegistry, chatHistoryCache });
        console.log(`[User] ✅ ${userId} initialized`);
    }

    /** Ensure tenant context exists. Promise-cached — safe to call concurrently or repeatedly. */
    private _ensureTenantContext(tenantKey: TenantKey, adapter: PlatformAdapter): Promise<void> {
        if (!this._tenantInitPromises.has(tenantKey)) {
            this._tenantInitPromises.set(tenantKey, this._doInitTenantContext(tenantKey, adapter));
        }
        return this._tenantInitPromises.get(tenantKey)!;
    }

    private async _doInitTenantContext(tenantKey: TenantKey, adapter: PlatformAdapter): Promise<void> {
        if (hasTenantContext(tenantKey)) return;
        const userId = resolveUserId(tenantKey);
        if (!userId) {
            console.warn(`[Tenant] ⚠️  ${tenantKey} has no user mapping — skipping`);
            return;
        }

        await this._ensureUserContext(userId);
        const userCtx = getUserContext(userId);

        const asyncTaskManager = new AsyncTaskManager(tenantKey);
        await asyncTaskManager.init();
        const messageQueue = new MessageQueue(tenantKey);
        const { userId: platformUserId } = parseTenantKey(tenantKey);

        registerTenantContext({
            tenantKey,
            chatId: platformUserId,
            userId,
            user: userCtx,
            workDir: userCtx.workDir,
            systemInstruction: userCtx.systemInstruction,
            adapter,
            chatHistoryCache: userCtx.chatHistoryCache,
            asyncTaskManager,
            messageQueue,
            todoManager: userCtx.todoManager,
            userProfile: userCtx.userProfile,
            skillRegistry: userCtx.skillRegistry,
        });

        console.log(`[Tenant] ✅ ${tenantKey} → user:${userId}`);
    }

    private _setupAsyncPolling(tenantKey: TenantKey, client: PlatformAdapter): void {
        const ctx = getTenantContext(tenantKey);
        setupAsyncPollingFn({
            asyncTaskManager: ctx.asyncTaskManager,
            geminiClient: this.llm,
            sendReply: (cId, text, retries, rId) => this._sendReply(client, cId, text, retries, rId),
            activeTaskIds: this.activeTaskIds,
        });
    }

    /** Initialize web tenants — one synthetic SSE-backed tenant per user with webToken. */
    private async _initWebTenants(): Promise<void> {
        if (!(process.env.WEB_PORT ?? process.env.WEB_ENABLED)) return;

        const webTenantKeys = getAuthorizedForPlatform('web');
        for (const tk of webTenantKeys) {
            const { userId } = parseTenantKey(tk);
            const webEgress = this._makeWebEgress(userId);
            await this._ensureTenantContext(tk, webEgress);
            this._setupAsyncPolling(tk, webEgress);
        }
        if (webTenantKeys.length > 0) {
            console.log(`[web] ✅ ${webTenantKeys.length} web tenant(s) configured.`);
        }
    }

    /** Create a synthetic PlatformAdapter for web tenants that pushes via SSE. */
    private _makeWebEgress(userId: string): PlatformAdapter {
        return {
            platform: 'web',
            start: async () => {},
            stop: async () => {},
            onMessage: () => {},
            onCallbackQuery: () => {},
            sendMessage: async (chatId: string, text: string) => {
                this.sendWebPush(chatId, text);
                return { id: 'web', chatId };
            },
            editMessage: async () => {},
            deleteMessage: async () => {},
            sendPhoto: async (chatId: string) => ({ id: 'web', chatId }),
            downloadFile: async () => { throw new Error('[WebEgress] downloadFile not supported'); },
            formatMarkdown: (md: string) => md,
        };
    }

    // ── Per-user lifecycle (reminders & schedules) ────────────────────────

    private async _initUserLifecycle(userId: UserId): Promise<void> {
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
                    tc.messageQueue.schedule(task, (t: Task) => this._processTask(tc.adapter, tc.tenantKey, t));
                }
                await tc.adapter.sendMessage(
                    tc.chatId,
                    `♻️ 检测到 ${pending.length} 条上次未完成的消息，已自动恢复处理。`
                ).catch(() => {});
            }
        }

        // Unified TodoManager: one-time reminders + recurring cron tasks
        await userCtx.todoManager.init(
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
                        await tc.messageQueue.enqueue(task, (t: Task) => this._processTask(tc.adapter, tc.tenantKey, t));
                    } else {
                        await tc.adapter.sendMessage(
                            tc.chatId,
                            `⏰ **提醒:** ${todo.content}`,
                            { parseMode: 'markdown' },
                        ).catch((err: any) => console.error(`[Todo] Send to ${tc.tenantKey} failed:`, err.message));
                    }
                }
            },
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
                        await tc.messageQueue.enqueue(queueTask, (t: Task) => this._processTask(tc.adapter, tc.tenantKey, t));
                    } catch (err: any) {
                        console.error(`[Todo] Cron failed for ${tc.tenantKey}:`, err.message);
                    }
                }
            },
        );
    }

    // ── Message processing pipeline ──────────────────────────────────────

    private _sendReply(adapter: PlatformAdapter, chatId: string, text: string, retries = 2, replyToMessageId?: string) {
        return sendReplyFn(adapter, chatId, text, retries, replyToMessageId);
    }

    private _processTask(adapter: PlatformAdapter, tenantKey: TenantKey, task: Task) {
        const ctx = getTenantContext(tenantKey);
        return processTaskFn(
            {
                adapter,
                geminiClient: this.llm,
                chatHistoryCache: ctx.chatHistoryCache,
                userProfile: ctx.userProfile,
                sendReply: (cId, text, retries, rId) => this._sendReply(adapter, cId, text, retries, rId),
            },
            task,
        );
    }

    private _processMessage(adapter: PlatformAdapter, tenantKey: TenantKey, msg: NormalizedMessage) {
        const ctx = getTenantContext(tenantKey);
        return processMessageFn(
            {
                adapter,
                asyncTriggerPrefixes: ASYNC_TRIGGER_PREFIXES,
                pendingReadMatches: this.pendingReadMatches,
                todoManager: ctx.todoManager,
                messageQueue: ctx.messageQueue,
                processTask: (task) => this._processTask(adapter, tenantKey, task),
                handleAsyncTask: (innerMsg) => handleAsyncTaskFn(
                    {
                        asyncTaskManager: ctx.asyncTaskManager,
                        geminiClient: this.llm,
                        sendReply: (cId, text, retries, rId) => this._sendReply(adapter, cId, text, retries, rId),
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
                        processTask: (task) => this._processTask(adapter, tenantKey, task),
                    },
                    innerMsg,
                    url,
                ),
            },
            msg,
        );
    }

    private async _handleCallbackQuery(adapter: PlatformAdapter, cb: NormalizedCallback) {
        const { data, chatId, messageId } = cb;
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
            return;
        }

        if (data === 'saved_noop') {
            if (cb._raw && typeof (cb._raw as any).answerCbQuery === 'function') {
                await (cb._raw as any).answerCbQuery('已保存过了').catch(() => {});
            }
        }
    }

    // ── HTTP Server (Koa) ─────────────────────────────────────────────────

    private _buildKoa(): Koa {
        const app = new Koa();
        const router = new Router();

        app.use(_authMiddleware());
        app.use(bodyParser());

        this._installChatRoute(router);
        this._installSessionRoutes(router);
        this._installMeRoute(router);
        _installNotebookRoutes(router);
        _installTodoRoutes(router);
        _installNoteRoutes(router);

        app.use(router.routes());
        app.use(router.allowedMethods());

        // Serve built frontend static files (production)
        const distDir = join(__dirname, '../web/dist');
        app.use(serve(distDir));

        return app;
    }

    // ── /api/chat (SSE streaming) ─────────────────────────────────────────

    private _installChatRoute(router: Router): void {
        router.post('/api/chat', async (ctx) => {
            const body = ctx.request.body as Record<string, unknown>;
            const message = typeof body.message === 'string' ? body.message.trim() : '';
            const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

            if (!message) {
                ctx.status = 400;
                ctx.body = { error: 'message is required' };
                return;
            }

            const reqUserId: string | undefined = ctx.state.userId;
            const tenantKey = reqUserId ? (`web:${reqUserId}` as TenantKey) : undefined;
            const tenantCtx = tenantKey ? (() => {
                try { return getTenantContext(tenantKey); } catch { return undefined; }
            })() : undefined;

            // Set up SSE response
            const stream = new PassThrough();
            ctx.status = 200;
            ctx.set('Content-Type', 'text/event-stream');
            ctx.set('Cache-Control', 'no-cache');
            ctx.set('Connection', 'keep-alive');
            ctx.set('X-Accel-Buffering', 'no');
            ctx.body = stream;

            if (reqUserId) this.registerWebStream(reqUserId, stream);

            const abortController = new AbortController();
            ctx.req.on('close', () => {
                abortController.abort();
                if (reqUserId) this.unregisterWebStream(reqUserId);
            });

            const write = (obj: Record<string, unknown>) => {
                if (!stream.destroyed) stream.write(`data: ${JSON.stringify(obj)}\n\n`);
            };

            // Build per-request ToolContext (uses tenant's shared services)
            let toolContext: ToolContext | undefined;
            if (tenantCtx) {
                toolContext = {
                    tenantKey: tenantCtx.tenantKey,
                    userId: tenantCtx.userId,
                    chatId: reqUserId!,
                    workDir: tenantCtx.workDir,
                    systemInstruction: tenantCtx.systemInstruction,
                    adapter: {
                        sendMessage: async (_chatId, text) => {
                            write({ type: 'text', text });
                            return { id: 'web', chatId: _chatId };
                        },
                        sendPhoto: async (_chatId, _photo, caption) => {
                            if (caption) write({ type: 'text', text: caption });
                            return { id: 'web', chatId: _chatId };
                        },
                    },
                    todoManager: tenantCtx.todoManager,
                    skillRegistry: tenantCtx.skillRegistry,
                    imageCallback: async (data, mimeType, caption) => {
                        write({ type: 'image', data, mimeType, ...(caption ? { caption } : {}) });
                    },
                };
            }

            const cache = tenantCtx?.chatHistoryCache;
            if (cache) await cache.addMessage('user', message);
            const history = cache?.getContextForGemini() ?? [];

            let fullResponse = '';
            try {
                await this.llm.chatWithContextStreaming(
                    message,
                    history,
                    (chunk) => {
                        write(chunk as Record<string, unknown>);
                        if ((chunk as { type: string; text?: string }).type === 'text') {
                            fullResponse += (chunk as { text?: string }).text ?? '';
                        }
                    },
                    abortController.signal,
                    toolContext,
                    model,
                );
                write({ type: 'done' });
            } catch (err: unknown) {
                if (!(err instanceof Error && err.name === 'AbortError')) {
                    write({ type: 'error', text: err instanceof Error ? err.message : String(err) });
                }
            } finally {
                stream.end();
                if (fullResponse && cache) {
                    cache.addMessage('assistant', fullResponse).catch(console.error);
                }
            }
        });
    }

    // ── /api/session ──────────────────────────────────────────────────────

    private _installSessionRoutes(router: Router): void {
        const newSession = async (ctx: Koa.Context) => {
            const reqUserId: string | undefined = ctx.state.userId;
            const tenantKey = reqUserId ? (`web:${reqUserId}` as TenantKey) : undefined;
            const tenantCtx = tenantKey ? (() => {
                try { return getTenantContext(tenantKey); } catch { return undefined; }
            })() : undefined;

            if (tenantCtx) {
                await tenantCtx.chatHistoryCache.createNewSession();
            }
            ctx.body = { ok: true };
        };

        router.post('/api/session/new', newSession);
        router.post('/api/session/clear', newSession);
    }

    // ── /api/me ───────────────────────────────────────────────────────────

    private _installMeRoute(router: Router): void {
        router.get('/api/me', async (ctx) => {
            const reqUserId: string | undefined = ctx.state.userId;
            if (!reqUserId) {
                ctx.body = { userId: null, displayName: null, profile: null };
                return;
            }
            const userCtx = getUserContext(reqUserId);
            const profile = await userCtx.userProfile.read() as string;
            const nameMatch = profile.match(/[-*]\s*姓名[:：]\s*(.+)/);
            const displayName = nameMatch?.[1]?.trim() || reqUserId;
            ctx.body = { userId: reqUserId, displayName, profile };
        });
    }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function _authMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        if (!ctx.path.startsWith('/api/')) return next();

        const authHeader = ctx.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

        const userId = token ? resolveUserIdByWebToken(token) : undefined;
        if (userId) {
            ctx.state.userId = userId;
            return next();
        }

        if (!hasWebTokens()) {
            ctx.state.userId = undefined;
            return next();
        }

        ctx.status = 401;
        ctx.body = { error: 'Unauthorized' };
    };
}

// ── Notebook routes ───────────────────────────────────────────────────────────

function _installNotebookRoutes(router: Router): void {
    router.get('/api/notebook', async (ctx) => {
        const q = ctx.query as Record<string, string>;
        switch (q.action) {
            case 'list':
                ctx.body = nbList({ limit: 1000 });
                break;
            case 'search': {
                const term = q.q?.trim() ?? '';
                if (!term) { ctx.body = []; return; }
                ctx.body = nbSearch(term, 50);
                break;
            }
            case 'read': {
                const id = Number(q.id);
                if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
                const row = nbGet(id);
                if (!row) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
                ctx.body = row;
                break;
            }
            default:
                ctx.status = 400;
                ctx.body = { error: `Unknown action: ${q.action ?? '(none)'}` };
        }
    });

    router.post('/api/notebook', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) { ctx.status = 400; ctx.body = { error: 'title required' }; return; }
        ctx.body = nbCreate({
            title,
            author:  typeof body.author  === 'string' ? body.author  : null,
            date:    typeof body.date    === 'string' ? body.date    : null,
            source:  typeof body.source  === 'string' ? body.source  : null,
            summary: typeof body.summary === 'string' ? body.summary : null,
            tags:    typeof body.tags    === 'string' ? body.tags    : null,
            content: typeof body.content === 'string' ? body.content : null,
        });
    });

    router.patch('/api/notebook/:id', async (ctx) => {
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const updated = nbUpdate(id, {
            title:   body.title   !== undefined ? String(body.title)   : undefined,
            author:  body.author  !== undefined ? (body.author  === null ? null : String(body.author))  : undefined,
            date:    body.date    !== undefined ? (body.date    === null ? null : String(body.date))    : undefined,
            source:  body.source  !== undefined ? (body.source  === null ? null : String(body.source))  : undefined,
            summary: body.summary !== undefined ? (body.summary === null ? null : String(body.summary)) : undefined,
            tags:    body.tags    !== undefined ? (body.tags    === null ? null : String(body.tags))    : undefined,
            content: body.content !== undefined ? (body.content === null ? null : String(body.content)) : undefined,
        });
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = updated;
    });

    router.delete('/api/notebook/:id', async (ctx) => {
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        if (!nbDelete(id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── Todo routes ───────────────────────────────────────────────────────────────

function _installTodoRoutes(router: Router): void {
    router.post('/api/todos/analyze', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }

        const now = new Date();
        const prompt = `Current datetime: ${now.toISOString()} (${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} CST)

Analyze this todo item and return a JSON object:
"${content}"

Return ONLY valid JSON with these fields:
- content: slightly cleaned/clarified todo text (keep short, in the original language)
- remind_at: ISO 8601 datetime string if the text implies a time (e.g. "明天" next day 09:00, "下午3点" today 15:00, "下周一" next Monday 09:00), otherwise null
- priority: "high" / "medium" / "low" based on urgency keywords, or null

Example: {"content":"预约牙医","remind_at":"2026-04-09T09:00:00+08:00","priority":"medium"}`;

        const result = await geminiGenerate(
            GEMINI_API_KEY,
            [{ role: 'user', parts: [{ text: prompt }] }],
            { model: 'flash', generationConfig: { responseMimeType: 'application/json' } }
        );

        if (!result) { ctx.body = { content, remind_at: null, priority: null }; return; }
        try {
            const parsed = JSON.parse(result);
            ctx.body = {
                content: typeof parsed.content === 'string' ? parsed.content : content,
                remind_at: typeof parsed.remind_at === 'string' ? parsed.remind_at : null,
                priority: typeof parsed.priority === 'string' ? parsed.priority : null,
            };
        } catch {
            ctx.body = { content, remind_at: null, priority: null };
        }
    });

    router.get('/api/todos', (ctx) => {
        const todos = todoList('web');
        ctx.body = todos.map(t => ({
            id: t.id,
            content: t.content,
            status: t.status === 'done' ? 'completed' : t.status === 'pending' ? 'not-started' : t.status,
            priority: t.priority,
            remind_at: t.fireAt ? new Date(t.fireAt).toISOString() : null,
            created_at: new Date(t.createdAt).toISOString(),
            updated_at: new Date(t.updatedAt).toISOString(),
        }));
    });

    router.post('/api/todos', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const priority = typeof body.priority === 'string' && body.priority.trim() ? body.priority.trim() : null;
        const remindAt = typeof body.remind_at === 'string' && body.remind_at.trim() ? body.remind_at.trim() : null;
        const fireAt = remindAt ? new Date(remindAt).getTime() : null;

        const todo = todoAdd('web', { content, status: 'pending', priority, fireAt });
        ctx.body = {
            id: todo.id,
            content: todo.content,
            status: 'not-started',
            priority: todo.priority,
            remind_at: todo.fireAt ? new Date(todo.fireAt).toISOString() : null,
            created_at: new Date(todo.createdAt).toISOString(),
            updated_at: new Date(todo.updatedAt).toISOString(),
        };
    });

    router.patch('/api/todos/:id', async (ctx) => {
        const todoId = ctx.params.id;
        const body = ctx.request.body as Record<string, unknown>;
        const patch: Record<string, any> = {};

        if (body.status !== undefined) {
            const status = body.status as string;
            const validStatuses = ['not-started', 'completed'];
            if (!validStatuses.includes(status)) { ctx.status = 400; ctx.body = { error: 'invalid status' }; return; }
            patch.status = status === 'completed' ? 'done' : 'pending';
        }
        if (body.content !== undefined) {
            const content = typeof body.content === 'string' ? body.content.trim() : '';
            if (!content) { ctx.status = 400; ctx.body = { error: 'content cannot be empty' }; return; }
            patch.content = content;
        }
        if (body.remind_at !== undefined) {
            if (body.remind_at === null) {
                patch.fireAt = null;
            } else {
                const remindAt = typeof body.remind_at === 'string' ? body.remind_at.trim() || null : null;
                patch.fireAt = remindAt ? new Date(remindAt).getTime() : null;
            }
        }
        if (body.priority !== undefined) {
            patch.priority = body.priority === null ? null : (typeof body.priority === 'string' ? body.priority.trim() || null : null);
        }

        const ok = todoPatch('web', todoId, patch);
        if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });

    router.delete('/api/todos/:id', (ctx) => {
        todoDelete('web', ctx.params.id);
        ctx.body = { ok: true };
    });
}

// ── Note routes ───────────────────────────────────────────────────────────────

function _installNoteRoutes(router: Router): void {
    router.get('/api/notes', (ctx) => {
        const q = ctx.query as Record<string, string>;
        ctx.body = noteList({ date: q.date, tag: q.tag });
    });

    router.get('/api/notes/stats', (ctx) => {
        ctx.body = noteStats();
    });

    router.get('/api/notes/tags', (ctx) => {
        ctx.body = noteTags();
    });

    router.post('/api/notes', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const tags = Array.isArray(body.tags) ? (body.tags as string[]) : undefined;
        ctx.body = noteCreate(content, tags);
    });

    router.delete('/api/notes/:id', (ctx) => {
        const noteId = Number(ctx.params.id);
        if (!noteId) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        noteDelete(noteId);
        ctx.body = { ok: true };
    });
}
