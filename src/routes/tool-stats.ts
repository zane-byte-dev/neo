/**
 * tool-stats.ts — GET /api/tool-stats
 *
 * Returns in-memory tool call statistics (call counts, success/error/blocked
 * breakdown, average/max duration, last-called timestamp). Requires an
 * authenticated user; stats are global across all users.
 */
import type Router from '@koa/router';
import { getToolStats } from '../utils/tool-stats.js';

export function toolStatsRoute(router: Router): void {
    router.get('/api/tool-stats', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'unauthorized' };
            return;
        }
        ctx.body = getToolStats();
    });
}
