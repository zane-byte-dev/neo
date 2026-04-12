import type Router from '@koa/router';
import { sessionCreate, sessionList, sessionPatch, sessionDelete, messageList } from '../services/chat-service.js';

export function newSession(router: Router): void {
    router.post('/api/session/clear', async (ctx: import('koa').Context) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (reqUserId) {
            await sessionCreate(reqUserId);
        }
        ctx.body = { ok: true };
    });

    router.get('/api/sessions', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const rows = await sessionList(userId);
        ctx.body = rows.map((s) => ({
            id: s.id,
            title: s.title || 'New Chat',
            isPinned: s.is_pinned === 1,
            createdAt: new Date(s.start_time).getTime(),
        }));
    });

    router.patch('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const body = ctx.request.body as Record<string, unknown>;
        const patch: { title?: string; is_pinned?: number } = {};
        if (typeof body.title === 'string') patch.title = body.title;
        if (typeof body.isPinned === 'boolean') patch.is_pinned = body.isPinned ? 1 : 0;
        const updated = await sessionPatch(id, userId, patch);
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });

    router.delete('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const ok = await sessionDelete(id, userId);
        ctx.body = { ok };
    });

    router.get('/api/messages', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }
        const sessionId = ctx.query.sessionId as string | undefined;
        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }
        const rows = await messageList(sessionId, userId);
        ctx.body = rows.map((r) => ({
            id: String(r.id),
            role: r.role === 'model' ? 'assistant' : r.role,
            content: r.content,
            timestamp: new Date(r.timestamp).getTime(),
        }));
    });
}



