/**
 * platform/web/web-adapter.ts — Web UI implementation of PlatformAdapter.
 *
 * Wraps the Koa HTTP server and normalizes web sessions into the PlatformAdapter
 * interface so reminders, schedules, and the core pipeline can reach web clients
 * just like they do for Telegram/Feishu.
 *
 * Architecture notes:
 *   - One tenant per user: TenantKey = `web:{userId}`
 *   - chatId in TenantContext = userId (from parseTenantKey)
 *   - activeStreams: userId → current SSE PassThrough (latest browser session)
 *   - /api/chat streams directly via geminiClient (bypasses MessageQueue for
 *     synchronous request/response) but uses the App-managed TenantContext
 *     (chatHistoryCache, skillRegistry, workDir, etc.)
 *   - sendMessage(chatId=userId) pushes to the active SSE stream; used by
 *     reminders/schedules broadcasting to all tenants.
 */

import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { PassThrough } from 'stream';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nbList, nbSearch, nbGet, nbCreate, nbUpdate, nbDelete } from '../../services/notebook-service.js';
import { noteList, noteStats, noteTags, noteCreate, noteDelete } from '../../services/note-service.js';
import { getTenantContext } from '../../services/tool-context.js';
import { getUserContext } from '../../services/user-context.js';
import { TodoManager } from '../../services/todo-manager.js';
import { geminiGenerate } from '../../llm/providers/gemini/index.js';
import { GEMINI_API_KEY, resolveUserIdByWebToken, hasWebTokens } from '../../config.js';
import type { LLMClient } from '../../llm/client.js';
import type { ToolContext } from '../../llm/types.js';
import type {
    PlatformAdapter,
    NormalizedMessage,
    NormalizedCallback,
    SendMessageOptions,
    SentMessage,
    TenantKey,
} from '../../types/platform.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);

export class WebAdapter implements PlatformAdapter {
    readonly platform = 'web' as const;

    private messageHandler?: (msg: NormalizedMessage) => Promise<void>;
    private callbackHandler?: (cb: NormalizedCallback) => Promise<void>;

    /** userId → active SSE stream for the latest browser session */
    private readonly activeStreams = new Map<string, PassThrough>();

    private server?: ReturnType<Koa['listen']>;

    constructor(private readonly geminiClient: LLMClient) {}

    // ── Lifecycle ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        const webEnabled = process.env.WEB_PORT ?? process.env.WEB_ENABLED;
        if (!webEnabled) return;

        const koa = this._buildKoa();
        this.server = koa.listen(WEB_PORT, () => {
            console.log(`[WebAdapter] 🌐 http://localhost:${WEB_PORT}`);
            if (!hasWebTokens()) {
                console.warn('[WebAdapter] ⚠️  No webToken in users.json — web UI is unprotected!');
            }
        });
    }

    async stop(): Promise<void> {
        await new Promise<void>((resolve) => {
            if (this.server) this.server.close(() => resolve());
            else resolve();
        });
    }

    // ── PlatformAdapter: event registration ─────────────────────────────

    onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onCallbackQuery(handler: (cb: NormalizedCallback) => Promise<void>): void {
        this.callbackHandler = handler;
    }

    // ── PlatformAdapter: outbound messaging ──────────────────────────────

    /**
     * chatId is the userId (from parseTenantKey('web:zhengchao') = 'zhengchao').
     * Writes a push event to the user's currently active SSE stream, if any.
     */
    async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<SentMessage> {
        const stream = this.activeStreams.get(chatId);
        if (stream && !stream.destroyed) {
            stream.write(`data: ${JSON.stringify({ type: 'push', text })}\n\n`);
        }
        return { id: 'web', chatId };
    }

    async editMessage(_chatId: string, _messageId: string, _text: string, _opts?: SendMessageOptions): Promise<void> {
        // No persistent message editing in web SSE
    }

    async deleteMessage(_chatId: string, _messageId: string): Promise<void> {
        // No-op for web
    }

    async sendPhoto(chatId: string, _photo: string | Buffer, caption?: string): Promise<SentMessage> {
        if (caption) await this.sendMessage(chatId, caption);
        return { id: 'web', chatId };
    }

    async downloadFile(_fileId: string, _destPath: string): Promise<void> {
        throw new Error('[WebAdapter] downloadFile is not supported');
    }

    formatMarkdown(md: string): string {
        return md; // Web frontend renders Markdown natively
    }

    // ── Internal: stream registry ────────────────────────────────────────

    private _registerStream(userId: string, stream: PassThrough): void {
        this.activeStreams.set(userId, stream);
    }

    private _unregisterStream(userId: string): void {
        this.activeStreams.delete(userId);
    }

    // ── Internal: Koa app builder ────────────────────────────────────────

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
        const distDir = join(__dirname, '../../../web/dist');
        app.use(serve(distDir));

        return app;
    }

    // ── Chat route (SSE streaming) ───────────────────────────────────────

    private _installChatRoute(router: Router): void {
        router.post('/api/chat', async (ctx) => {
            const body = ctx.request.body as Record<string, unknown>;
            const message = typeof body.message === 'string' ? body.message.trim() : '';
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : 'default';
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

            // Set up SSE stream
            const stream = new PassThrough();
            ctx.status = 200;
            ctx.set('Content-Type', 'text/event-stream');
            ctx.set('Cache-Control', 'no-cache');
            ctx.set('Connection', 'keep-alive');
            ctx.set('X-Accel-Buffering', 'no');
            ctx.body = stream;

            if (reqUserId) this._registerStream(reqUserId, stream);

            const abortController = new AbortController();
            ctx.req.on('close', () => {
                abortController.abort();
                if (reqUserId) this._unregisterStream(reqUserId);
            });

            const write = (obj: Record<string, unknown>) => {
                if (!stream.destroyed) stream.write(`data: ${JSON.stringify(obj)}\n\n`);
            };

            // Build ToolContext from App-managed tenant context
            let toolContext: ToolContext | undefined;
            if (tenantCtx) {
                toolContext = {
                    tenantKey: tenantCtx.tenantKey,
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

            // Use App-managed ChatHistoryCache (not a per-route local cache)
            const cache = tenantCtx?.chatHistoryCache;
            if (cache) await cache.addMessage('user', message);
            const history = cache?.getContextForGemini() ?? [];

            let fullResponse = '';
            try {
                await this.geminiClient.chatWithContextStreaming(
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

    // ── Session routes ───────────────────────────────────────────────────

    private _installSessionRoutes(router: Router): void {
        const newSession = async (ctx: Koa.Context) => {
            const body = ctx.request.body as Record<string, unknown>;
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
            if (!sessionId) { ctx.status = 400; ctx.body = { error: 'sessionId required' }; return; }

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

    // ── /api/me ──────────────────────────────────────────────────────────

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

// ── Auth middleware ──────────────────────────────────────────────────────────

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

// ── Notebook routes ──────────────────────────────────────────────────────────

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


// ── Todo routes ──────────────────────────────────────────────────────────────

/** Lazy-init a lightweight TodoManager for web-scoped todos (no cron/fire callbacks needed). */
let _webTodoManager: TodoManager | null = null;
function getWebTodoManager(): TodoManager {
    if (!_webTodoManager) {
        _webTodoManager = new TodoManager('web');
        // Web todos are plain items — no fire/cron callbacks needed, init with no-ops
        _webTodoManager.init(async () => {}, async () => {});
    }
    return _webTodoManager;
}

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
        const tm = getWebTodoManager();
        const todos = tm.getTodos();
        // Map to the shape the web frontend expects
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

        const tm = getWebTodoManager();
        const todo = tm.add({ content, status: 'pending', priority, fireAt });
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
        const tm = getWebTodoManager();

        const patch: Record<string, any> = {};

        if (body.status !== undefined) {
            const status = body.status as string;
            const validStatuses = ['not-started', 'completed'];
            if (!validStatuses.includes(status)) { ctx.status = 400; ctx.body = { error: 'invalid status' }; return; }
            // Map web statuses to internal: not-started → pending, completed → done
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

        const ok = tm.patch(todoId, patch);
        if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });

    router.delete('/api/todos/:id', (ctx) => {
        const tm = getWebTodoManager();
        tm.delete(ctx.params.id);
        ctx.body = { ok: true };
    });
}

// ── Note routes ──────────────────────────────────────────────────────────────

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
