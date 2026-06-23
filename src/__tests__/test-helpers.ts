/**
 * Test helper: build a minimal Koa app with the same auth middleware as CoreServer.
 * Routes are registered manually — no auto-loader, no real tool setup.
 */
import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import { timingSafeEqual } from 'crypto';
import Keygrip from 'keygrip';
import { SESSION_SECRET } from '../config.js';
import { SESSION_COOKIE } from '../const/cookie.js';
import { hasApiTokenConfigured, userGetByApiToken } from '../services/user-service.js';

export interface TestAppOptions {
    basicAuthUser?: string;
    basicAuthPass?: string;
}

/**
 * Create a Koa app with auth middleware — same logic as CoreServer.
 * Returns { app, router, mount } so callers can register routes, then call mount().
 */
export function createTestApp(opts: TestAppOptions = {}) {
    const app = new Koa();
    app.keys = [SESSION_SECRET!];
    const router = new Router();

    // Optional Basic Auth
    if (opts.basicAuthUser && opts.basicAuthPass) {
        const user = opts.basicAuthUser;
        const pass = opts.basicAuthPass;
        app.use(async (ctx, next) => {
            if (ctx.path.startsWith('/v1/')) return next();

            const auth = ctx.get('authorization');
            if (!auth.startsWith('Basic ')) {
                ctx.set('WWW-Authenticate', 'Basic realm="neo"');
                ctx.status = 401;
                ctx.body = { error: 'Unauthorized' };
                return;
            }
            let decoded = '';
            try {
                decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
            } catch {
                ctx.status = 401;
                ctx.body = { error: 'Unauthorized' };
                return;
            }
            const idx = decoded.indexOf(':');
            if (idx < 0) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
            const u = decoded.slice(0, idx);
            const p = decoded.slice(idx + 1);
            const uBuf = Buffer.from(u);
            const pBuf = Buffer.from(p);
            const uExp = Buffer.from(user);
            const pExp = Buffer.from(pass);
            const uOk = uBuf.length === uExp.length && timingSafeEqual(uBuf, uExp);
            const pOk = pBuf.length === pExp.length && timingSafeEqual(pBuf, pExp);
            if (!uOk || !pOk) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
            return next();
        });
    }

    // Cookie auth (same as server.ts _authMiddleware)
    app.use(async (ctx, next) => {
        if (ctx.path.startsWith('/v1/')) {
            if (!hasApiTokenConfigured()) {
                ctx.status = 403;
                ctx.body = { error: { message: 'Neo provider API is disabled', code: 'api_disabled' } };
                return;
            }
            const auth = ctx.get('authorization');
            if (!auth.startsWith('Bearer ')) {
                ctx.status = 401;
                ctx.body = { error: { message: 'Missing API token', code: 'missing_api_token' } };
                return;
            }
            const user = userGetByApiToken(auth.slice('Bearer '.length).trim());
            if (!user) {
                ctx.status = 401;
                ctx.body = { error: { message: 'Invalid API token', code: 'invalid_api_token' } };
                return;
            }
            ctx.state.userId = user.id;
            return next();
        }

        if (!ctx.path.startsWith('/api/')) return next();
        if (ctx.path === '/api/auth/login') return next();
        const userId = ctx.cookies.get(SESSION_COOKIE, { signed: true });
        if (userId) {
            ctx.state.userId = userId;
            return next();
        }
        ctx.status = 401;
        ctx.body = { error: 'Unauthorized' };
    });

    app.use(bodyParser({ jsonLimit: '20mb' }));

    // Mount routes after all middleware are added
    const mount = () => {
        app.use(router.routes());
        app.use(router.allowedMethods());
    };

    return { app, router, mount };
}

/**
 * Build a signed cookie header string for supertest requests.
 */
export function signedCookie(userId: string): string {
    const keys = new Keygrip([SESSION_SECRET!]);
    const val = `${SESSION_COOKIE}=${userId}`;
    const sig = keys.sign(val);
    return `${val}; ${SESSION_COOKIE}.sig=${sig}`;
}
