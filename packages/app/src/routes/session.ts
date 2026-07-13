import type Router from '@koa/router';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { sessionCreate, sessionList, sessionPatch, sessionDelete, sessionSoftDelete, sessionGetByNotebook, messageList, messageAdd } from '@neo/agent/services/chat-service.js';
import { calcUser } from '@neo/agent/services/user-service.js';
import { trashRegisterSession } from '../services/trash-service.js';

interface SessionMessageResponse {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    citations?: Array<{
        n: number;
        sourceId: string;
        title: string;
        snippet?: string;
        chunkId?: string;
        charStart?: number;
        charEnd?: number;
    }>;
}


export function newSession(router: Router): void {
    router.post('/api/session/clear', async (ctx: import('koa').Context) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (reqUserId) {
            const body = (ctx.request.body ?? {}) as Record<string, unknown>;
            let projectRoot: string | undefined;
            if (typeof body.projectRoot === 'string' && body.projectRoot.trim()) {
                const abs = resolve(body.projectRoot.trim());
                try {
                    const stat = await fs.stat(abs);
                    if (!stat.isDirectory()) {
                        ctx.status = 400; ctx.body = { error: 'projectRoot is not a directory' }; return;
                    }
                    projectRoot = abs;
                } catch {
                    ctx.status = 400; ctx.body = { error: `projectRoot does not exist: ${abs}` }; return;
                }
            }
            const session = await sessionCreate(reqUserId, undefined, projectRoot ? { projectRoot } : undefined);
            ctx.body = { ok: true, session: { id: session.id, projectRoot: session.project_root ?? null } };
            return;
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
            isArchived: s.is_archived === 1,
            createdAt: new Date(s.start_time).getTime(),
            updatedAt: new Date(s.end_time || s.start_time).getTime(),
            projectRoot: s.project_root ?? null,
            mode: s.mode ?? 'general',
            ...(s.notebook_id !== undefined && { notebookId: s.notebook_id }),
            ...(s.source_ids !== undefined && { sourceIds: s.source_ids }),
            ...(s.model !== undefined && { chatModel: s.model }),
        }));
    });

    router.post('/api/session/import', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'Imported Chat';
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        const messages = rawMessages
            .map((item) => typeof item === 'object' && item !== null ? item as Record<string, unknown> : null)
            .filter((item): item is Record<string, unknown> => item !== null)
            .map((item) => ({
                role: item.role === 'assistant' || item.role === 'model' ? 'assistant' as const : 'user' as const,
                content: typeof item.content === 'string' ? item.content : '',
            }))
            .filter((item) => item.content.trim());
        if (messages.length === 0) {
            ctx.status = 400;
            ctx.body = { error: 'messages are required' };
            return;
        }
        const session = await sessionCreate(userId, undefined, { title });
        for (const message of messages.slice(0, 500)) {
            await messageAdd(session.id, userId, message.role, message.content);
        }
        ctx.body = {
            ok: true,
            session: {
                id: session.id,
                title,
                isPinned: false,
                isArchived: false,
                createdAt: new Date(session.start_time).getTime(),
                updatedAt: Date.now(),
                projectRoot: session.project_root ?? null,
                mode: session.mode ?? 'general',
            },
        };
    });

    /**
     * Find or create the (single) chat session bound to a notebook.
     * Body: { notebookId: string, sourceIds?: string[] }
     */
    router.post('/api/sessions/notebook', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const notebookId = typeof body.notebookId === 'string' && body.notebookId.trim() ? body.notebookId.trim() : '';
        if (!notebookId) { ctx.status = 400; ctx.body = { error: 'notebookId required' }; return; }
        const rawSourceIds = Array.isArray(body.sourceIds)
            ? (body.sourceIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
            : undefined;

        let session = await sessionGetByNotebook(userId, notebookId);
        if (!session) {
            session = await sessionCreate(userId, undefined, {
                mode: 'notebook',
                notebookId,
                title: `Notebook: ${notebookId}`,
                ...(rawSourceIds && rawSourceIds.length > 0 ? { sourceIds: rawSourceIds } : {}),
            });
        } else if (rawSourceIds !== undefined) {
            await sessionPatch(session.id, userId, { source_ids: rawSourceIds });
            session = { ...session, source_ids: rawSourceIds.length > 0 ? rawSourceIds : undefined };
        }
        ctx.body = {
            session: {
                id: session.id,
                title: session.title || `Notebook: ${notebookId}`,
                isPinned: session.is_pinned === 1,
                isArchived: session.is_archived === 1,
                createdAt: new Date(session.start_time).getTime(),
                updatedAt: new Date(session.end_time || session.start_time).getTime(),
                projectRoot: session.project_root ?? null,
                mode: 'notebook' as const,
                notebookId,
                ...(session.source_ids !== undefined && { sourceIds: session.source_ids }),
            },
        };
    });

    router.patch('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const body = ctx.request.body as Record<string, unknown>;
        const patch: { title?: string; is_pinned?: number; is_archived?: number; project_root?: string | null; source_ids?: string[] | null; model?: string | null } = {};
        if (typeof body.title === 'string') patch.title = body.title;
        if (typeof body.isPinned === 'boolean') patch.is_pinned = body.isPinned ? 1 : 0;
        if (typeof body.isArchived === 'boolean') patch.is_archived = body.isArchived ? 1 : 0;
        if (body.chatModel === null || body.chatModel === '') {
            patch.model = null;
        } else if (typeof body.chatModel === 'string' && body.chatModel.trim()) {
            patch.model = body.chatModel.trim();
        }
        if (body.sourceIds === null) {
            patch.source_ids = null;
        } else if (Array.isArray(body.sourceIds)) {
            patch.source_ids = (body.sourceIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
        }
        if (body.projectRoot === null || body.projectRoot === '') {
            patch.project_root = null;
        } else if (typeof body.projectRoot === 'string') {
            const abs = resolve(body.projectRoot.trim());
            try {
                const stat = await fs.stat(abs);
                if (!stat.isDirectory()) { ctx.status = 400; ctx.body = { error: 'projectRoot is not a directory' }; return; }
            } catch {
                ctx.status = 400; ctx.body = { error: `projectRoot does not exist: ${abs}` }; return;
            }
            patch.project_root = abs;
        }
        const updated = await sessionPatch(id, userId, patch);
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = {
            ok: true,
            session: {
                id: updated.id,
                title: updated.title,
                isPinned: updated.is_pinned === 1,
                isArchived: updated.is_archived === 1,
                projectRoot: updated.project_root ?? null,
                mode: updated.mode ?? 'general',
                ...(updated.notebook_id !== undefined && { notebookId: updated.notebook_id }),
                ...(updated.source_ids !== undefined && { sourceIds: updated.source_ids }),
                ...(updated.model !== undefined && { chatModel: updated.model }),
            },
        };
    });

    router.delete('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const { stateDir } = await calcUser(userId);
        const session = await sessionSoftDelete(id, userId);
        if (session) {
            await trashRegisterSession(stateDir, id, session.title || '(无标题)');
        }
        ctx.body = { ok: !!session };
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
        ctx.body = buildSessionMessagesResponse(rows);
    });
}

function buildSessionMessagesResponse(
    rows: Awaited<ReturnType<typeof messageList>>,
): SessionMessageResponse[] {
    return rows.map((row) => {
        const base: SessionMessageResponse = {
            id: String(row.id),
            role: (row.role === 'model' ? 'assistant' : row.role) as 'user' | 'assistant',
            content: row.content,
            timestamp: new Date(row.timestamp).getTime(),
        };
        if (row.citations && row.citations.length > 0) base.citations = row.citations;
        return base;
    });
}
