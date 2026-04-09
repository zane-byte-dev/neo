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
import { getDb } from '../../services/db.js';
import { getTenantContext } from '../../services/tool-context.js';
import { getUserContext } from '../../services/user-context.js';
import { geminiGenerate } from '../../services/gemini-client.js';
import { GEMINI_API_KEY, resolveUserIdByWebToken, hasWebTokens } from '../../config.js';
import type { GeminiClient, ToolContext } from '../../services/gemini-client.js';
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

    constructor(private readonly geminiClient: GeminiClient) {}

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
        _installCronRoutes(router);
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
                    reminderManager: tenantCtx.reminderManager,
                    scheduledTaskManager: tenantCtx.scheduledTaskManager,
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
        const db = getDb();
        const q = ctx.query as Record<string, string>;
        switch (q.action) {
            case 'list':
                ctx.body = db.prepare(
                    `SELECT id, title, author, date, source, summary, tags
                     FROM notebook_entries ORDER BY date DESC, id DESC`
                ).all();
                break;
            case 'search': {
                const term = q.q?.trim() ?? '';
                if (!term) { ctx.body = []; return; }
                try {
                    ctx.body = db.prepare(
                        `SELECT n.id, n.title, n.author, n.date, n.source, n.summary, n.tags
                         FROM notebook_fts f
                         JOIN notebook_entries n ON n.id = f.rowid
                         WHERE notebook_fts MATCH ?
                         ORDER BY rank LIMIT 50`
                    ).all(term);
                } catch {
                    ctx.body = db.prepare(
                        `SELECT id, title, author, date, source, summary, tags
                         FROM notebook_entries WHERE title LIKE ? OR content LIKE ?
                         LIMIT 50`
                    ).all(`%${term}%`, `%${term}%`);
                }
                break;
            }
            case 'read': {
                const id = Number(q.id);
                if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
                const row = db.prepare('SELECT * FROM notebook_entries WHERE id = ?').get(id);
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
        const db = getDb();
        const body = ctx.request.body as Record<string, unknown>;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) { ctx.status = 400; ctx.body = { error: 'title required' }; return; }
        const author  = typeof body.author  === 'string' && body.author.trim()  ? body.author.trim()  : null;
        const date    = typeof body.date    === 'string' && body.date.trim()    ? body.date.trim()    : null;
        const source  = typeof body.source  === 'string' && body.source.trim()  ? body.source.trim()  : null;
        const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null;
        const tags    = typeof body.tags    === 'string' && body.tags.trim()    ? body.tags.trim()    : null;
        const content = typeof body.content === 'string' ? body.content : null;
        const now = new Date().toISOString();
        const result = db.prepare(
            `INSERT INTO notebook_entries (title, author, date, source, summary, tags, content, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(title, author, date, source, summary, tags, content, now, now);
        ctx.body = { id: result.lastInsertRowid, title, author, date, source, summary, tags, content, created_at: now, updated_at: now };
    });

    router.patch('/api/notebook/:id', async (ctx) => {
        const db = getDb();
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        const existing = db.prepare('SELECT * FROM notebook_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!existing) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const now = new Date().toISOString();
        const title   = typeof body.title   === 'string' ? body.title.trim()   : existing.title;
        const author  = body.author  !== undefined ? (typeof body.author  === 'string' && body.author.trim()  ? body.author.trim()  : null) : existing.author;
        const date    = body.date    !== undefined ? (typeof body.date    === 'string' && body.date.trim()    ? body.date.trim()    : null) : existing.date;
        const source  = body.source  !== undefined ? (typeof body.source  === 'string' && body.source.trim()  ? body.source.trim()  : null) : existing.source;
        const summary = body.summary !== undefined ? (typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null) : existing.summary;
        const tags    = body.tags    !== undefined ? (typeof body.tags    === 'string' && body.tags.trim()    ? body.tags.trim()    : null) : existing.tags;
        const content = body.content !== undefined ? (typeof body.content === 'string' ? body.content : null) : existing.content;
        db.prepare(
            `UPDATE notebook_entries SET title=?, author=?, date=?, source=?, summary=?, tags=?, content=?, updated_at=? WHERE id=?`
        ).run(title, author, date, source, summary, tags, content, now, id);
        ctx.body = { id, title, author, date, source, summary, tags, content, updated_at: now };
    });

    router.delete('/api/notebook/:id', async (ctx) => {
        const db = getDb();
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        const result = db.prepare('DELETE FROM notebook_entries WHERE id = ?').run(id);
        if (result.changes === 0) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── Cron routes ──────────────────────────────────────────────────────────────

function _installCronRoutes(router: Router): void {
    router.get('/api/crons', async (ctx) => {
        const db = getDb();
        ctx.body = db.prepare(`
            SELECT
                j.name, j.schedule, j.description, j.enabled, j.updated_at,
                r.status       AS last_status,
                r.started_at   AS last_started_at,
                r.finished_at  AS last_finished_at,
                r.duration_ms  AS last_duration_ms,
                r.error        AS last_error,
                r.summary      AS last_summary
            FROM cron_jobs j
            LEFT JOIN cron_runs r ON r.id = (
                SELECT id FROM cron_runs WHERE job_name = j.name ORDER BY started_at DESC LIMIT 1
            )
            ORDER BY j.name
        `).all();
    });

    router.patch('/api/crons/:name', async (ctx) => {
        const db = getDb();
        const jobName = decodeURIComponent(ctx.params.name);
        const body = ctx.request.body as Record<string, unknown>;
        const now = Date.now();
        const existing = db.prepare('SELECT name FROM cron_jobs WHERE name = ?').get(jobName);
        if (!existing) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        if (body.enabled !== undefined) {
            db.prepare('UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE name = ?').run(body.enabled ? 1 : 0, now, jobName);
        }
        if (typeof body.schedule === 'string' && body.schedule.trim()) {
            db.prepare('UPDATE cron_jobs SET schedule = ?, updated_at = ? WHERE name = ?').run(body.schedule.trim(), now, jobName);
        }
        ctx.body = { ok: true };
    });

    router.get('/api/crons/:name/runs', async (ctx) => {
        const db = getDb();
        const jobName = decodeURIComponent(ctx.params.name);
        const limit = Math.min(Number(ctx.query.limit) || 20, 100);
        ctx.body = db.prepare(
            'SELECT id, job_name, status, started_at, finished_at, duration_ms, error, summary FROM cron_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT ?'
        ).all(jobName, limit);
    });

    router.post('/api/crons/:name/run', async (ctx) => {
        const jobName = decodeURIComponent(ctx.params.name);
        const { executeJob } = await import('../../crons/index.js');
        ctx.body = await executeJob(jobName);
    });
}

// ── Todo routes ──────────────────────────────────────────────────────────────

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

    router.get('/api/todos', async (ctx) => {
        const db = getDb();
        ctx.body = db.prepare(
            `SELECT id, content, status, priority, remind_at, created_at, updated_at
             FROM todos
             ORDER BY
               CASE status WHEN 'not-started' THEN 0 ELSE 1 END,
               remind_at ASC NULLS LAST,
               created_at DESC`
        ).all();
    });

    router.post('/api/todos', async (ctx) => {
        const db = getDb();
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        const priority = typeof body.priority === 'string' && body.priority.trim() ? body.priority.trim() : null;
        const remindAt = typeof body.remind_at === 'string' && body.remind_at.trim() ? body.remind_at.trim() : null;
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const id = Math.random().toString(36).slice(2, 10);
        const now = new Date().toISOString();
        db.prepare(
            `INSERT INTO todos (id, tenant_key, content, status, priority, remind_at, created_at, updated_at)
             VALUES (?, 'web', ?, 'not-started', ?, ?, ?, ?)`
        ).run(id, content, priority, remindAt, now, now);
        ctx.body = { id, content, status: 'not-started', priority, remind_at: remindAt, created_at: now, updated_at: now };
    });

    router.patch('/api/todos/:id', async (ctx) => {
        const db = getDb();
        const todoId = ctx.params.id;
        const body = ctx.request.body as Record<string, unknown>;
        const now = new Date().toISOString();
        const validStatuses = ['not-started', 'completed'];
        if (body.status !== undefined) {
            const status = body.status as string;
            if (!validStatuses.includes(status)) { ctx.status = 400; ctx.body = { error: 'invalid status' }; return; }
            const result = db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run(status, now, todoId);
            if (result.changes === 0) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        }
        if (body.content !== undefined) {
            const content = typeof body.content === 'string' ? body.content.trim() : '';
            if (!content) { ctx.status = 400; ctx.body = { error: 'content cannot be empty' }; return; }
            db.prepare('UPDATE todos SET content = ?, updated_at = ? WHERE id = ?').run(content, now, todoId);
        }
        if (body.remind_at !== undefined) {
            const remindAt = body.remind_at === null ? null : (typeof body.remind_at === 'string' ? body.remind_at.trim() || null : null);
            db.prepare('UPDATE todos SET remind_at = ?, updated_at = ? WHERE id = ?').run(remindAt, now, todoId);
        }
        if (body.priority !== undefined) {
            const priority = body.priority === null ? null : (typeof body.priority === 'string' ? body.priority.trim() || null : null);
            db.prepare('UPDATE todos SET priority = ?, updated_at = ? WHERE id = ?').run(priority, now, todoId);
        }
        ctx.body = { ok: true };
    });

    router.delete('/api/todos/:id', async (ctx) => {
        const db = getDb();
        db.prepare('DELETE FROM todos WHERE id = ?').run(ctx.params.id);
        ctx.body = { ok: true };
    });
}

// ── Note routes ──────────────────────────────────────────────────────────────

function _installNoteRoutes(router: Router): void {
    router.get('/api/notes', async (ctx) => {
        const db = getDb();
        const q = ctx.query as Record<string, string>;
        if (q.tag) {
            const all = db.prepare(
                `SELECT id, content, date, time, created_at, tags FROM notes ORDER BY created_at DESC LIMIT 500`
            ).all() as Array<Record<string, unknown>>;
            ctx.body = all.filter((n) => {
                try { return (JSON.parse(n.tags as string) as string[]).includes(q.tag); } catch { return false; }
            });
        } else if (q.date) {
            ctx.body = db.prepare(
                `SELECT id, content, date, time, created_at, tags FROM notes WHERE date = ? ORDER BY created_at DESC`
            ).all(q.date);
        } else {
            ctx.body = db.prepare(
                `SELECT id, content, date, time, created_at, tags FROM notes ORDER BY created_at DESC LIMIT 200`
            ).all();
        }
    });

    router.get('/api/notes/stats', async (ctx) => {
        const db = getDb();
        ctx.body = db.prepare(
            `SELECT date, COUNT(*) as count FROM notes GROUP BY date ORDER BY date`
        ).all();
    });

    router.get('/api/notes/tags', async (ctx) => {
        const db = getDb();
        const rows = db.prepare(
            `SELECT tags FROM notes WHERE tags IS NOT NULL AND tags != '[]'`
        ).all() as Array<{ tags: string }>;
        const tagCount = new Map<string, number>();
        for (const row of rows) {
            try {
                for (const t of JSON.parse(row.tags) as string[]) {
                    tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
                }
            } catch { /* skip */ }
        }
        ctx.body = Array.from(tagCount.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    });

    router.post('/api/notes', async (ctx) => {
        const db = getDb();
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : null;
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0].slice(0, 5);
        const createdAt = now.getTime();
        const result = db.prepare(
            `INSERT INTO notes (tenant_key, content, date, time, created_at, tags) VALUES ('web', ?, ?, ?, ?, ?)`
        ).run(content, date, time, createdAt, tags);
        ctx.body = { id: result.lastInsertRowid, content, date, time, created_at: createdAt, tags };
    });

    router.delete('/api/notes/:id', async (ctx) => {
        const db = getDb();
        const noteId = Number(ctx.params.id);
        if (!noteId) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
        ctx.body = { ok: true };
    });
}
