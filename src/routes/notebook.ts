import type Router from '@koa/router';
import { nbList, nbSearch, nbGet, nbCreate, nbUpdate, nbDelete } from '../services/notebook-service.js';

export function notebookGet(router: Router): void {
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
}

export function notebookCreate(router: Router): void {
    router.post('/api/notebook', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) { ctx.status = 400; ctx.body = { error: 'title required' }; return; }
        ctx.body = nbCreate({
            title,
            author: typeof body.author === 'string' ? body.author : null,
            date: typeof body.date === 'string' ? body.date : null,
            source: typeof body.source === 'string' ? body.source : null,
            summary: typeof body.summary === 'string' ? body.summary : null,
            tags: typeof body.tags === 'string' ? body.tags : null,
            content: typeof body.content === 'string' ? body.content : null,
        });
    });
}

export function notebookUpdate(router: Router): void {
    router.patch('/api/notebook/:id', async (ctx) => {
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const updated = nbUpdate(id, {
            title: body.title !== undefined ? String(body.title) : undefined,
            author: body.author !== undefined ? (body.author === null ? null : String(body.author)) : undefined,
            date: body.date !== undefined ? (body.date === null ? null : String(body.date)) : undefined,
            source: body.source !== undefined ? (body.source === null ? null : String(body.source)) : undefined,
            summary: body.summary !== undefined ? (body.summary === null ? null : String(body.summary)) : undefined,
            tags: body.tags !== undefined ? (body.tags === null ? null : String(body.tags)) : undefined,
            content: body.content !== undefined ? (body.content === null ? null : String(body.content)) : undefined,
        });
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = updated;
    });
}

export function notebookDelete(router: Router): void {
    router.delete('/api/notebook/:id', async (ctx) => {
        const id = Number(ctx.params.id);
        if (!id) { ctx.status = 400; ctx.body = { error: 'invalid id' }; return; }
        if (!nbDelete(id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}


