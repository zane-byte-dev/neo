import type Router from '@koa/router';
import { userGetByWebToken } from '../services/user-service.js';
import { COOKIE_OPTS, SESSION_COOKIE } from '../const/cookie.js';

export function login(router: Router): void {
    router.post('/api/auth/login', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        const userRaw = token ? userGetByWebToken(token) : undefined;
        if (!userRaw) {
            ctx.status = 401;
            ctx.body = { error: 'Invalid token' };
            return;
        }
        const userId = userRaw.id;
        ctx.cookies.set(SESSION_COOKIE, userId, COOKIE_OPTS);
        ctx.body = { ok: true, userId };
    });
}

export function logout(router: Router): void {
    router.post('/api/auth/logout', (ctx) => {
        ctx.cookies.set(SESSION_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
        ctx.body = { ok: true };
    });
}

