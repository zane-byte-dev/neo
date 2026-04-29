import type Router from '@koa/router';
import { calcUser } from '../services/user-service.js';

export function me(router: Router): void {
    router.get('/api/me', async (ctx) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (!reqUserId) {
            ctx.body = { userId: null, displayName: null, profile: null };
            return;
        }
        const userCtx = await calcUser(reqUserId);
        const profile = await userCtx.userProfile.read() as string;
        const nameMatch = profile.match(/[-*]\s*姓名[:：]\s*(.+)/);
        const displayName = nameMatch?.[1]?.trim() || reqUserId;
        ctx.body = { userId: reqUserId, displayName, profile };
    });
}

export function initWorkspace(router: Router): void {
    router.post('/api/me/workspace/init', async (ctx) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (!reqUserId) {
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }

        const userCtx = await calcUser(reqUserId, true);
        const profile = await userCtx.userProfile.read() as string;
        const nameMatch = profile.match(/[-*]\s*姓名[:：]\s*(.+)/);
        const displayName = nameMatch?.[1]?.trim() || reqUserId;

        ctx.body = {
            ok: true,
            userId: reqUserId,
            displayName,
            profile,
        };
    });
}


