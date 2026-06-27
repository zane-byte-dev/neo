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
import { neoAgentRuntime } from '../app/agent-runtime.js';
import { calcUser } from '@neo/agent/services/user-service.js';
import { listRunIds, loadRun } from '@neo/runtime';

export function runsRoute(router: Router): void {
    // ── GET /api/runs ────────────────────────────────────────────────
    router.get('/api/runs', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir ?? userCtx.workDir;

        const limit = _parseLimit(ctx.query.limit, 50, 200);
        const ids = listRunIds(stateDir).slice(0, limit);
        const runs = await Promise.all(ids.map((id) => loadRun(stateDir, id)));
        // Filter out any unreadable run.json files and runs owned by
        // other users (defensive — workspace is per-user but the
        // metadata may have been hand-edited).
        ctx.body = {
            runs: runs.filter((r): r is NonNullable<typeof r> => r !== null && r.userId === userId),
        };
    });

    // ── GET /api/runs/:id ────────────────────────────────────────────
    router.get('/api/runs/:id', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        const userCtx = await calcUser(userId);
        const stateDir = userCtx.stateDir ?? userCtx.workDir;
        const id = ctx.params.id;
        const run = await loadRun(stateDir, id);
        if (!run) { ctx.status = 404; ctx.body = { error: 'not_found' }; return; }
        if (run.userId !== userId) { ctx.status = 403; ctx.body = { error: 'forbidden' }; return; }
        ctx.body = { run };
    });

    // ── GET /api/runs/:id/events ─────────────────────────────────────
    router.get('/api/runs/:id/events', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        const id = ctx.params.id;

        const cursor = _parseInt(ctx.query.cursor, -1);
        const limit = _parseLimit(ctx.query.limit, 200, 1000);
        try {
            ctx.body = await neoAgentRuntime.events(userId, id, {
                afterIndex: cursor,
                limit,
            });
        } catch (err) {
            _respondRuntimeError(ctx, err);
        }
    });

    // ── POST /api/runs/:id/cancel ────────────────────────────────────
    router.post('/api/runs/:id/cancel', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'unauthorized' }; return; }
        const id = ctx.params.id;

        // Setting `metadata.cancelRequested` is observed by the
        // executor's cancellation probe (see runtime/executor.ts).
        // Terminal-state runs return ok with a no-op flag.
        try {
            ctx.body = await neoAgentRuntime.cancelRun(userId, id);
        } catch (err) {
            _respondRuntimeError(ctx, err);
        }
    });
}

function _respondRuntimeError(ctx: { status: number; body: unknown }, err: unknown): void {
    const code = typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'not_found') {
        ctx.status = 404;
        ctx.body = { error: 'not_found' };
        return;
    }
    if (code === 'forbidden') {
        ctx.status = 403;
        ctx.body = { error: 'forbidden' };
        return;
    }
    throw err;
}

function _parseInt(v: unknown, fallback: number): number {
    if (typeof v !== 'string') return fallback;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
}

function _parseLimit(v: unknown, fallback: number, max: number): number {
    const n = _parseInt(v, fallback);
    if (n <= 0) return fallback;
    return Math.min(n, max);
}
