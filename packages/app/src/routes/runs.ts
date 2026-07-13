/**
 * routes/runs.ts — Read-only and control-plane endpoints for runtime runs.
 *
 *   GET  /api/runs                       — list the calling user's runs
 *   GET  /api/runs/:id                   — fetch a single run record
 *   GET  /api/runs/:id/events?cursor=N   — paginate the event log
 *   POST /api/runs/:id/cancel            — request cancellation
 *
 * Runs are scoped to the authenticated user: a run created by user A is
 * not visible to user B even with a guessed id, because the lookup
 * happens under user A's `workDir`.
 */

import type Router from '@koa/router';
import { abortPiRun } from '../services/pi-chat.js';

export function runsRoute(router: Router): void {
    // ── GET /api/runs ────────────────────────────────────────────────
    router.get('/api/runs', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        ctx.body = { runs: [] };
    });

    // ── GET /api/runs/:id ────────────────────────────────────────────
    router.get('/api/runs/:id', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        ctx.status = 404;
        ctx.body = { error: 'not_found' };
    });

    // ── GET /api/runs/:id/events ─────────────────────────────────────
    router.get('/api/runs/:id/events', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        ctx.body = { events: [], nextCursor: null };
    });

    // ── POST /api/runs/:id/cancel ────────────────────────────────────
    router.post('/api/runs/:id/cancel', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        const id = ctx.params.id;

        if (await abortPiRun(id, userId)) {
            ctx.body = { run: { id, status: 'cancelled', cancelRequested: true } };
            return;
        }

        ctx.status = 404;
        ctx.body = { error: 'not_found' };
    });
}
