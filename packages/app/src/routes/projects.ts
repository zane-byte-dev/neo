/**
 * routes/projects.ts — Per-user "recent project directories" registry.
 *
 *   GET    /api/projects           → list recent project entries
 *   POST   /api/projects           → register a new project { path, name? }
 *   DELETE /api/projects/:id       → remove a project entry
 */

import type Router from '@koa/router';
import {
    listProjects,
    registerProject,
    removeProject,
} from '@neo/agent/services/project-registry.js';

export function newProjects(router: Router): void {
    router.get('/api/projects', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        ctx.body = { projects: await listProjects(userId) };
    });

    router.post('/api/projects', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const body = ctx.request.body as Record<string, unknown>;
        const path = typeof body.path === 'string' ? body.path : '';
        const name = typeof body.name === 'string' ? body.name : undefined;
        if (!path) { ctx.status = 400; ctx.body = { error: 'path is required' }; return; }
        try {
            const entry = await registerProject(userId, { path, name });
            ctx.body = entry;
        } catch (err) {
            ctx.status = 400;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });

    router.delete('/api/projects/:id', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const ok = await removeProject(userId, ctx.params.id);
        ctx.body = { ok };
    });
}
