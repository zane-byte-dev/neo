/**
 * src/web/server.ts — Koa-based web UI server.
 *
 * Provides:
 *   POST /api/chat        — SSE streaming AI chat
 *   GET  /api/notebook    — notebook list / search / read
 *   Static files          — serves web/dist/ in production
 *
 * Auth: Bearer token via WEB_TOKEN env var.
 * Enable by setting WEB_PORT (and optionally WEB_TOKEN).
 */

import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { PassThrough } from 'stream';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../services/db.js';
import { ChatHistoryCache } from '../services/chat-history-cache.js';
import { getTenantContext } from '../services/tool-context.js';
import { geminiGenerate } from '../services/gemini-client.js';
import { GEMINI_API_KEY } from '../config.js';
import type { TenantKey } from '../types/platform.js';
import type { GeminiClient, ToolContext } from '../services/gemini-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);
const WEB_TOKEN = process.env.WEB_TOKEN ?? '';

// ── Per-session history cache ─────────────────────────────────────────────────

const sessionCaches = new Map<string, ChatHistoryCache>();

async function getOrCreateCache(sessionId: string): Promise<ChatHistoryCache> {
    if (!sessionCaches.has(sessionId)) {
        const cache = new ChatHistoryCache(getDb(), `web:${sessionId}`);
        await cache.init();
        sessionCaches.set(sessionId, cache);
    }
    return sessionCaches.get(sessionId)!;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function authMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        if (!ctx.path.startsWith('/api/')) {
            return next();
        }
        if (WEB_TOKEN) {
            const authHeader = ctx.headers.authorization ?? '';
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
            if (token !== WEB_TOKEN) {
                ctx.status = 401;
                ctx.body = { error: 'Unauthorized' };
                return;
            }
        }
        return next();
    };
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createWebServer(geminiClient: GeminiClient, tenantKey?: TenantKey): Koa {
    const app = new Koa();
    const router = new Router();

    app.use(authMiddleware());
    app.use(bodyParser());

    // ── POST /api/chat — SSE streaming ────────────────────────────────────
    router.post('/api/chat', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

        if (!message) {
            ctx.status = 400;
            ctx.body = { error: 'message is required' };
            return;
        }

        // Build ToolContext from the tenant registry
        let toolContext: ToolContext | undefined;
        if (tenantKey) {
            const tenantCtx = getTenantContext(tenantKey);
            toolContext = {
                tenantKey,
                chatId: tenantCtx.chatId,
                adapter: tenantCtx.adapter,
                reminderManager: tenantCtx.reminderManager,
                scheduledTaskManager: tenantCtx.scheduledTaskManager,
            };
        }

        const cache = await getOrCreateCache(sessionId || 'default');
        await cache.addMessage('user', message);
        const history = cache.getContextForGemini();

        const stream = new PassThrough();
        ctx.status = 200;
        ctx.set('Content-Type', 'text/event-stream');
        ctx.set('Cache-Control', 'no-cache');
        ctx.set('Connection', 'keep-alive');
        ctx.set('X-Accel-Buffering', 'no');
        ctx.body = stream;

        const abortController = new AbortController();
        ctx.req.on('close', () => abortController.abort());

        const write = (obj: Record<string, unknown>) => {
            if (!stream.destroyed) {
                stream.write(`data: ${JSON.stringify(obj)}\n\n`);
            }
        };

        // Inject web image callback so generate_image streams via SSE instead of Telegram
        if (toolContext) {
            toolContext.imageCallback = async (data, mimeType, caption) => {
                write({ type: 'image', data, mimeType, ...(caption ? { caption } : {}) });
            };
        }

        let fullResponse = '';
        try {
            await geminiClient.chatWithContextStreaming(
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
            const name = err instanceof Error ? err.name : '';
            if (name !== 'AbortError') {
                write({ type: 'error', text: err instanceof Error ? err.message : String(err) });
            }
        } finally {
            stream.end();
            if (fullResponse) {
                cache.addMessage('assistant', fullResponse).catch(console.error);
            }
        }
    });

    // ── POST /api/session/new — start fresh conversation ──────────────────
    router.post('/api/session/new', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!sessionId) { ctx.status = 400; ctx.body = { error: 'sessionId required' }; return; }
        const cache = await getOrCreateCache(sessionId);
        await cache.createNewSession();
        ctx.body = { ok: true };
    });

    // ── POST /api/session/clear — alias for new session ───────────────────
    router.post('/api/session/clear', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!sessionId) { ctx.status = 400; ctx.body = { error: 'sessionId required' }; return; }
        const cache = await getOrCreateCache(sessionId);
        await cache.createNewSession();
        ctx.body = { ok: true };
    });

    // ── GET /api/notebook ─────────────────────────────────────────────────
    router.get('/api/notebook', async (ctx) => {
        const db = getDb();
        const q = ctx.query as Record<string, string>;
        const { action } = q;

        switch (action) {
            case 'list': {
                ctx.body = db.prepare(
                    `SELECT id, title, author, date, source, summary, tags
                     FROM notebook_entries ORDER BY date DESC, id DESC`
                ).all();
                break;
            }
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
                    // Fallback to LIKE if FTS query syntax is invalid
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
                ctx.body = { error: `Unknown action: ${action ?? '(none)'}` };
        }
    });

    // ── POST /api/notebook — create a notebook entry ──────────────────────
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

    // ── PATCH /api/notebook/:id — update a notebook entry ─────────────────
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

    // ── DELETE /api/notebook/:id — delete a notebook entry ────────────────
    router.delete('/api/notebook/:id', async (ctx) => {
        const db = getDb();
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        const result = db.prepare('DELETE FROM notebook_entries WHERE id = ?').run(id);
        if (result.changes === 0) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });

    // ── Cron jobs ─────────────────────────────────────────────────────────

    // GET /api/crons — list all cron jobs with last run info
    router.get('/api/crons', async (ctx) => {
        const db = getDb();
        const jobs = db.prepare(`
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
        ctx.body = jobs;
    });

    // PATCH /api/crons/:name — update enabled / schedule
    router.patch('/api/crons/:name', async (ctx) => {
        const db = getDb();
        const jobName = decodeURIComponent(ctx.params.name);
        const body = ctx.request.body as Record<string, unknown>;
        const now = Date.now();

        const existing = db.prepare('SELECT name FROM cron_jobs WHERE name = ?').get(jobName);
        if (!existing) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }

        if (body.enabled !== undefined) {
            const enabled = body.enabled ? 1 : 0;
            db.prepare('UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE name = ?').run(enabled, now, jobName);
        }
        if (typeof body.schedule === 'string' && body.schedule.trim()) {
            db.prepare('UPDATE cron_jobs SET schedule = ?, updated_at = ? WHERE name = ?').run(body.schedule.trim(), now, jobName);
        }
        ctx.body = { ok: true };
    });

    // GET /api/crons/:name/runs — recent runs for a job
    router.get('/api/crons/:name/runs', async (ctx) => {
        const db = getDb();
        const jobName = decodeURIComponent(ctx.params.name);
        const limit = Math.min(Number(ctx.query.limit) || 20, 100);
        const runs = db.prepare(
            'SELECT id, job_name, status, started_at, finished_at, duration_ms, error, summary FROM cron_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT ?'
        ).all(jobName, limit);
        ctx.body = runs;
    });

    // POST /api/crons/:name/run — manual trigger
    router.post('/api/crons/:name/run', async (ctx) => {
        const jobName = decodeURIComponent(ctx.params.name);
        const { executeJob } = await import('../crons/index.js');
        const result = await executeJob(jobName);
        ctx.body = result;
    });

    // ── POST /api/todos/analyze — AI-parse a todo text ────────────────────
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

    // ── GET /api/todos — list all todos ──────────────────────────────────
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

    // ── POST /api/todos — create a todo ───────────────────────────────────
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

    // ── PATCH /api/todos/:id — update status / content / remind_at / priority
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

    // ── DELETE /api/todos/:id ─────────────────────────────────────────────
    router.delete('/api/todos/:id', async (ctx) => {
        const db = getDb();
        db.prepare('DELETE FROM todos WHERE id = ?').run(ctx.params.id);
        ctx.body = { ok: true };
    });

    // ── GET /api/notes — list inbox notes ────────────────────────────────
    router.get('/api/notes', async (ctx) => {
        const db = getDb();
        const q = ctx.query as Record<string, string>;
        if (q.tag) {
            // Filter by tag: notes whose tags JSON array contains the tag
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

    // ── GET /api/notes/stats — heatmap data (counts per date) ────────────
    router.get('/api/notes/stats', async (ctx) => {
        const db = getDb();
        const rows = db.prepare(
            `SELECT date, COUNT(*) as count FROM notes GROUP BY date ORDER BY date`
        ).all() as Array<{ date: string; count: number }>;
        ctx.body = rows;
    });

    // ── GET /api/notes/tags — all unique tags ────────────────────────────
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

    // ── POST /api/notes — capture a note ─────────────────────────────────
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

    // ── DELETE /api/notes/:id ─────────────────────────────────────────────
    router.delete('/api/notes/:id', async (ctx) => {
        const db = getDb();
        const noteId = Number(ctx.params.id);
        if (!noteId) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
        ctx.body = { ok: true };
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    // Serve built frontend static files (production)
    const distDir = join(__dirname, '../../web/dist');
    app.use(serve(distDir));

    return app;
}

export function startWebServer(geminiClient: GeminiClient, tenantKey?: TenantKey): void {
    const webEnabled = process.env.WEB_PORT ?? process.env.WEB_ENABLED;
    if (!webEnabled) return;

    const app = createWebServer(geminiClient, tenantKey);
    app.listen(WEB_PORT, () => {
        console.log(`[WebServer] 🌐 http://localhost:${WEB_PORT}`);
        if (!WEB_TOKEN) {
            console.warn('[WebServer] ⚠️  WEB_TOKEN not set — web UI is unprotected!');
        }
    });
}
