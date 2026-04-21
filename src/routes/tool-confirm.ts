/**
 * tool-confirm.ts — POST /api/tool-confirm
 *
 * Client-side UI calls this to approve/deny a dangerous tool invocation
 * that was paused on the SSE stream via `{ type: 'tool_confirm', confirmId }`.
 */
import type Router from '@koa/router';
import { resolveConfirm } from '../utils/pending-confirm.js';

export function toolConfirmRoute(router: Router): void {
    router.post('/api/tool-confirm', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'unauthorized' };
            return;
        }
        const body = ctx.request.body as Record<string, unknown>;
        const confirmId = typeof body.confirmId === 'string' ? body.confirmId : '';
        const approved = body.approved === true;
        if (!confirmId) {
            ctx.status = 400;
            ctx.body = { error: 'confirmId required' };
            return;
        }
        const ok = resolveConfirm(confirmId, userId, approved);
        if (!ok) {
            ctx.status = 404;
            ctx.body = { error: 'unknown or expired confirmId' };
            return;
        }
        ctx.body = { ok: true };
    });
}
