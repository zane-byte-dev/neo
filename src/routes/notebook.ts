import type Router from '@koa/router';
import { nbListNotebooks, nbList, nbSearch, nbGet, nbCreate, nbUpdate, nbDelete } from '../services/notebook-service.js';
import { calcUser } from '../services/user-service.js';

export function notebookGet(router: Router): void {
    router.get('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;

        switch (q.action) {
            case 'notebooks': {
                ctx.body = nbListNotebooks(workDir);
                break;
            }
            case 'list': {
                const limit = Math.min(Number(q.limit) || 200, 500);
                ctx.body = nbList(workDir, {
                    notebook: q.notebook || undefined,
                    limit,
                });
                break;
            }
            case 'search': {
                const term = q.q?.trim() ?? '';
                if (!term) { ctx.body = []; return; }
                ctx.body = nbSearch(workDir, term, {
                    notebook: q.notebook || undefined,
                    limit: 50,
                });
                break;
            }
            case 'read': {
                const id = q.id?.trim();
                if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
                const row = nbGet(workDir, id);
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
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const body = ctx.request.body as Record<string, unknown>;

        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) { ctx.status = 400; ctx.body = { error: 'title required' }; return; }

        const notebook = typeof body.notebook === 'string' && body.notebook.trim()
            ? body.notebook.trim()
            : 'personal';

        ctx.body = nbCreate(workDir, notebook, {
            title,
            author:  typeof body.author  === 'string' ? body.author  : null,
            date:    typeof body.date    === 'string' ? body.date    : null,
            source:  typeof body.source  === 'string' ? body.source  : null,
            summary: typeof body.summary === 'string' ? body.summary : null,
            tags:    typeof body.tags    === 'string' ? body.tags    : null,
            content: typeof body.content === 'string' ? body.content : null,
        });
    });
}

export function notebookUpdate(router: Router): void {
    router.patch('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const id = q.id?.trim();
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }

        const body = ctx.request.body as Record<string, unknown>;
        const updated = nbUpdate(workDir, id, {
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
}

export function notebookDelete(router: Router): void {
    router.delete('/api/notebook', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { workDir } = await calcUser(userId);
        const q = ctx.query as Record<string, string>;
        const id = q.id?.trim();
        if (!id) { ctx.status = 400; ctx.body = { error: 'id required' }; return; }
        if (!nbDelete(workDir, id)) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });
}


