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

function isLocalHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function gatewayBaseUrl(origin: string): string {
    const webPort = process.env.WEB_PORT ?? '3000';
    const explicit = process.env.NEO_GATEWAY_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, '').endsWith('/v1') ? explicit.replace(/\/+$/, '') : `${explicit.replace(/\/+$/, '')}/v1`;

    let url: URL;
    try {
        url = new URL(origin.includes('://') ? origin : `http://${origin}`);
    } catch {
        url = new URL(`http://localhost:${webPort}`);
    }
    if (isLocalHost(url.hostname) && url.port !== webPort) {
        url.port = webPort;
    }
    url.pathname = '/v1';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
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
        ctx.body = { gateway: await getGatewayStatus(cfg, userCtx.stateDir, gatewayBaseUrl(ctx.origin)) };
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
            }, gatewayBaseUrl(ctx.origin)),
        };
    });
}