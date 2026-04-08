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

    // ── GET /api/todos — list all todos ──────────────────────────────────
    router.get('/api/todos', async (ctx) => {
        const db = getDb();
        ctx.body = db.prepare(
            `SELECT id, content, status, priority, created_at, updated_at
             FROM todos
             ORDER BY
               CASE status WHEN 'in-progress' THEN 0 WHEN 'not-started' THEN 1 ELSE 2 END,
               created_at DESC`
        ).all();
    });

    // ── POST /api/todos — create a todo ───────────────────────────────────
    router.post('/api/todos', async (ctx) => {
        const db = getDb();
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        const priority = typeof body.priority === 'string' && body.priority.trim() ? body.priority.trim() : null;
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const id = Math.random().toString(36).slice(2, 10);
        const now = new Date().toISOString();
        db.prepare(
            `INSERT INTO todos (id, tenant_key, content, status, priority, created_at, updated_at)
             VALUES (?, 'web', ?, 'not-started', ?, ?, ?)`
        ).run(id, content, priority, now, now);
        ctx.body = { id, content, status: 'not-started', priority, created_at: now, updated_at: now };
    });

    // ── PATCH /api/todos/:id — update status / content ────────────────────
    router.patch('/api/todos/:id', async (ctx) => {
        const db = getDb();
        const todoId = ctx.params.id;
        const body = ctx.request.body as Record<string, unknown>;
        const validStatuses = ['not-started', 'in-progress', 'completed'];
        if (body.status !== undefined) {
            const status = body.status as string;
            if (!validStatuses.includes(status)) { ctx.status = 400; ctx.body = { error: 'invalid status' }; return; }
            const now = new Date().toISOString();
            const result = db.prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?').run(status, now, todoId);
            if (result.changes === 0) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
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
        if (q.date) {
            ctx.body = db.prepare(
                `SELECT id, content, date, time, created_at FROM notes WHERE date = ? ORDER BY created_at DESC`
            ).all(q.date);
        } else {
            ctx.body = db.prepare(
                `SELECT id, content, date, time, created_at FROM notes ORDER BY created_at DESC LIMIT 200`
            ).all();
        }
    });

    // ── POST /api/notes — capture a note ─────────────────────────────────
    router.post('/api/notes', async (ctx) => {
        const db = getDb();
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0].slice(0, 5);
        const createdAt = now.getTime();
        const result = db.prepare(
            `INSERT INTO notes (tenant_key, content, date, time, created_at) VALUES ('web', ?, ?, ?, ?)`
        ).run(content, date, time, createdAt);
        ctx.body = { id: result.lastInsertRowid, content, date, time, created_at: createdAt };
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
