/**
 * src/routes/gateway.ts — Local AI Gateway settings API.
 */

import type Router from '@koa/router';
import { calcUser } from '../services/user-service.js';
import { getUsersConfig } from '../config.js';
import { getGatewayStatus, updateGatewayStatus } from '../services/gateway-settings.js';

function userConfig(userId: string) {
    return getUsersConfig().find((user) => user.id === userId);
}

export function gateway(router: Router): void {
    router.get('/api/gateway', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const cfg = userConfig(userId);
        if (!cfg) {
            ctx.status = 404;
            ctx.body = { error: 'User not found' };
            return;
        }
        const userCtx = await calcUser(userId);
        ctx.body = { gateway: await getGatewayStatus(cfg, userCtx.stateDir, `${ctx.origin}/v1`) };
    });

    router.post('/api/gateway', async (ctx) => {
        const userId = ctx.state.userId as string | undefined;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Not authenticated' };
            return;
        }
        const cfg = userConfig(userId);
        if (!cfg) {
            ctx.status = 404;
            ctx.body = { error: 'User not found' };
            return;
        }
        const body = (ctx.request.body ?? {}) as Record<string, unknown>;
        const userCtx = await calcUser(userId);
        ctx.body = {
            gateway: await updateGatewayStatus(cfg, userCtx.stateDir, {
                enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
                rotate: body.rotate === true,
            }, `${ctx.origin}/v1`),
        };
    });
}