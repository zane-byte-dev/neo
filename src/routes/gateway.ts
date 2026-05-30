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

function gatewayBaseUrl(origin: string | null | undefined): string {
    const rawOrigin = typeof origin === 'string' ? origin : '';
    try {
        const url = new URL(rawOrigin);
        if (url.port === '5173') {
            url.port = process.env.WEB_PORT ?? '3000';
        }
        return `${url.origin}/v1`;
    } catch {
        return rawOrigin ? `${rawOrigin.replace(/\/$/, '')}/v1` : '/v1';
    }
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
        const requestOrigin = ctx.origin ?? `${ctx.protocol}://${ctx.host}`;
        ctx.body = { gateway: await getGatewayStatus(cfg, userCtx.stateDir, gatewayBaseUrl(requestOrigin)) };
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
        const requestOrigin = ctx.origin ?? `${ctx.protocol}://${ctx.host}`;
        ctx.body = {
            gateway: await updateGatewayStatus(cfg, userCtx.stateDir, {
                enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
                rotate: body.rotate === true,
            }, gatewayBaseUrl(requestOrigin)),
        };
    });
}
