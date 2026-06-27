/**
 * src/routes/trash.ts — Trash bin API.
 *
 *   GET  /api/trash            — list all trashed items (articles + sessions + notebooks)
 *   POST /api/trash/restore    — restore one item  { id: string }
 *   DELETE /api/trash/:id      — permanently delete one item
 *   DELETE /api/trash          — empty all trash (body: { all: true })
 */
import type Router from '@koa/router';
import {
    trashList,
    trashRestore,
    trashPermanentDelete,
    trashEmpty,
    trashRemoveSessionEntry,
} from '../services/trash-service.js';
import {
    sessionListDeleted,
    sessionRestoreFromTrash,
    sessionDelete,
} from '@neo/agent/services/chat-service.js';
import { calcUser } from '@neo/agent/services/user-service.js';
import type { TrashItem } from '../services/trash-service.js';

// ── GET /api/trash ────────────────────────────────────────────────────────────

export function trashGet(router: Router): void {
    router.get('/api/trash', async (ctx) => {
        const userId = ctx.state.userId as string;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }

        const { stateDir } = await calcUser(userId);

        // Article + notebook items from manifest
        const manifestItems = await trashList(stateDir);

        // Soft-deleted sessions from chat-service
        const deletedSessions = await sessionListDeleted(userId);
        const sessionItems: TrashItem[] = deletedSessions.map((s) => ({
            id: `session:${s.id}`,
            type: 'session' as const,
            title: s.title || '(无标题)',
            deletedAt: s.deleted_at ? new Date(s.deleted_at).getTime() : 0,
            sessionId: s.id,
        }));

        const all = [...manifestItems, ...sessionItems]
            .sort((a, b) => b.deletedAt - a.deletedAt);

        ctx.body = { items: all };
    });
}

// ── POST /api/trash/restore ───────────────────────────────────────────────────

export function trashRestoreItem(router: Router): void {
    router.post('/api/trash/restore', async (ctx) => {
        const userId = ctx.state.userId as string;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }

        const body = (ctx.request.body ?? {}) as Record<string, unknown>;
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }

        const { workDir, stateDir } = await calcUser(userId);

        // Session items use the virtual id "session:{sessionId}"
        if (id.startsWith('session:')) {
            const sessionId = id.slice('session:'.length);
            const ok = await sessionRestoreFromTrash(sessionId, userId);
            if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
            await trashRemoveSessionEntry(stateDir, sessionId);
            ctx.body = { ok: true };
            return;
        }

        const ok = await trashRestore(workDir, stateDir, id);
        if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── DELETE /api/trash/:id ─────────────────────────────────────────────────────

export function trashDeleteItem(router: Router): void {
    router.delete('/api/trash/:id', async (ctx) => {
        const userId = ctx.state.userId as string;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }

        const rawId = ctx.params.id as string;
        const { stateDir } = await calcUser(userId);

        if (rawId.startsWith('session:')) {
            const sessionId = rawId.slice('session:'.length);
            await sessionDelete(sessionId, userId);
            await trashRemoveSessionEntry(stateDir, sessionId);
            ctx.body = { ok: true };
            return;
        }

        const ok = await trashPermanentDelete(stateDir, rawId);
        if (!ok) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}

// ── DELETE /api/trash (empty all) ─────────────────────────────────────────────

export function trashDeleteAll(router: Router): void {
    router.delete('/api/trash', async (ctx) => {
        const userId = ctx.state.userId as string;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }

        const { stateDir } = await calcUser(userId);

        // Hard-delete all soft-deleted sessions
        const deletedSessions = await sessionListDeleted(userId);
        for (const s of deletedSessions) {
            await sessionDelete(s.id, userId).catch(() => {});
        }

        // Purge manifest items
        const count = await trashEmpty(stateDir);
        ctx.body = { ok: true, count: count + deletedSessions.length };
    });
}
