/**
 * tool-result.ts — GET /api/tool-result/:id
 *
 * Fetch the full body of a previously streamed tool_result by the id emitted
 * on the SSE stream. Ownership is enforced: callers can only read results
 * produced for their own userId.
 */
import type Router from '@koa/router';
import { getToolResult } from '../utils/tool-result-cache.js';

export function toolResultRoute(router: Router): void {
    router.get('/api/tool-result/:id', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'unauthorized' };
            return;
        }
        const entry = getToolResult(String(ctx.params.id));
        if (!entry) {
            ctx.status = 404;
            ctx.body = { error: 'not_found' };
            return;
        }
        if (entry.userId !== userId) {
            ctx.status = 403;
            ctx.body = { error: 'forbidden' };
            return;
        }
        ctx.body = {
            id: ctx.params.id,
            toolName: entry.toolName,
            result: entry.result,
            createdAt: entry.createdAt,
        };
    });
}
