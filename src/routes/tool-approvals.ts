import type Router from '@koa/router';
import { calcUser } from '../services/user-service.js';
import { deleteToolApproval, listToolApprovals } from '@neo/runtime';

export function toolApprovalsRoute(router: Router): void {
    router.get('/api/tool-approvals', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }

        const userCtx = await calcUser(userId);
        const rules = await listToolApprovals(userCtx.stateDir ?? userCtx.workDir);
        ctx.body = { rules };
    });

    router.delete('/api/tool-approvals/:id', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }

        const ruleId = String(ctx.params.id ?? '').trim();
        if (!ruleId) {
            ctx.status = 400;
            ctx.body = { error: 'rule id required' };
            return;
        }

        const userCtx = await calcUser(userId);
        const deleted = await deleteToolApproval(userCtx.stateDir ?? userCtx.workDir, ruleId);
        if (!deleted) {
            ctx.status = 404;
            ctx.body = { error: 'rule not found' };
            return;
        }

        ctx.body = { ok: true };
    });
}
