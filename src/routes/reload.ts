/**
 * reload.ts — Hot-reload route for refreshing cached user context.
 *
 * POST /api/reload         — invalidate cache for the authenticated user
 * POST /api/reload/:userId — invalidate cache for a specific user (admin)
 *
 * After editing AGENTS.md, SOUL.md, USER.md, skills/, or .tools/,
 * call this endpoint to pick up changes without restarting the server.
 */
import type Router from '@koa/router';
import { invalidateUserCache } from '../services/user-service.js';

export function reloadRoute(router: Router): void {
    router.post('/api/reload', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (userId) {
            invalidateUserCache(userId);
            ctx.body = { ok: true, message: `Cache invalidated for user ${userId}` };
        } else {
            invalidateUserCache();
            ctx.body = { ok: true, message: 'Cache invalidated for all users' };
        }
    });

    router.post('/api/reload/:userId', async (ctx) => {
        const targetUserId = ctx.params.userId;
        invalidateUserCache(targetUserId);
        ctx.body = { ok: true, message: `Cache invalidated for user ${targetUserId}` };
    });
}
