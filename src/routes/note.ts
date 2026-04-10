import type Router from '@koa/router';
import { noteList, noteStats, noteTags, noteCreate, noteDelete } from '../services/note-service.js';

export function noteGetAll(router: Router): void {
    router.get('/api/notes', (ctx) => {
        const q = ctx.query as Record<string, string>;
        ctx.body = noteList({ date: q.date, tag: q.tag });
    });
}

export function noteGetStats(router: Router): void {
    router.get('/api/notes/stats', (ctx) => {
        ctx.body = noteStats();
    });
}

export function noteGetTags(router: Router): void {
    router.get('/api/notes/tags', (ctx) => {
        ctx.body = noteTags();
    });
}

export function notePost(router: Router): void {
    router.post('/api/notes', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) { ctx.status = 400; ctx.body = { error: 'content required' }; return; }
        const tags = Array.isArray(body.tags) ? (body.tags as string[]) : undefined;
        ctx.body = noteCreate(content, tags);
    });
}

export function noteRemove(router: Router): void {
    router.delete('/api/notes/:id', (ctx) => {
        const noteId = Number(ctx.params.id);
        if (!noteId) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        noteDelete(noteId);
        ctx.body = { ok: true };
    });
}


