import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { timingSafeEqual } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

import { SESSION_SECRET } from './config.js';
import { log } from './utils/logger.js';
import { setupTools } from './tools/index.js';
import { setupRoutes } from './routes/index.js';
import { SESSION_COOKIE } from './const/cookie.js';
import { sweepAllUserWorkspaces } from '@neo/runtime';
import { hasApiTokenConfigured, userGetByApiToken, userList } from './services/user-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);
const BASIC_AUTH_USER = process.env.EXTERNAL_BASIC_AUTH_USER ?? '';
const BASIC_AUTH_PASS = process.env.EXTERNAL_BASIC_AUTH_PASS ?? '';

export class CoreServer {
    /** Registered platform clients (telegram, feishu, …) */
    private httpServer?: ReturnType<Koa['listen']>;

    async start(): Promise<void> {
        await setupTools();

        // Recover any runtime runs that were left in flight when the
        // process previously exited. Fire-and-forget — sweeper failures
        // must never block server startup.
        void this._sweepRuntimeOnStartup();

        const app = new Koa();
        app.keys = [SESSION_SECRET!];
        const router = new Router();

        app.use(_optionalBasicAuthMiddleware());
        app.use(_requestLoggerMiddleware());
        app.use(_authMiddleware());
        app.use(bodyParser({ jsonLimit: '20mb' }));

        await setupRoutes(router);

        app.use(router.routes());
        app.use(router.allowedMethods());

        // Serve built frontend static files (production)
        const distDir = join(__dirname, '../web/dist');
        app.use(serve(distDir));

        // SPA fallback: serve index.html for non-API routes (client-side routing).
        // /apps/ is reserved for per-user mini web apps served by user-apps.ts;
        // never shadow them with the SPA shell.
        app.use(async (ctx) => {
            if (ctx.status === 404 && !ctx.path.startsWith('/api/') && !ctx.path.startsWith('/apps/')) {
                try {
                    ctx.type = 'html';
                    ctx.body = await readFile(join(distDir, 'index.html'));
                } catch { /* index.html missing – dev mode, ignore */ }
            }
        });

        this.httpServer = app.listen(WEB_PORT, () => {
            log.info('CoreServer', `http://localhost:${WEB_PORT}`);
        });
    }

    async shutdown(): Promise<void> {
        await new Promise<void>((res) => {
            if (this.httpServer) this.httpServer.close(() => res());
            else res();
        });
    }

    private async _sweepRuntimeOnStartup(): Promise<void> {
        try {
            const users = userList()
                .map((u) => ({ userId: u.id, workDir: u.stateDir }))
                .filter((u): u is { userId: string; workDir: string } => Boolean(u.workDir));
            if (users.length === 0) return;
            const results = await sweepAllUserWorkspaces(users);
            const totals = results.reduce(
                (acc, r) => ({
                    pending: acc.pending + r.expiredPendingActions,
                    waiting: acc.waiting + r.expiredRuns,
                    orphan: acc.orphan + r.orphanedRuns,
                }),
                { pending: 0, waiting: 0, orphan: 0 },
            );
            log.info('CoreServer', 'Runtime sweep complete', {
                users: users.length,
                ...totals,
            });
        } catch (err: unknown) {
            log.warn('CoreServer', 'Runtime sweep failed', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

// ── Request logger middleware ─────────────────────────────────────────────────

function _requestLoggerMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const start = Date.now();
        log.info('HTTP', `→ ${ctx.method} ${ctx.path}`);
        await next();
        const ms = Date.now() - start;
        // ctx.respond=false (SSE) bypasses Koa's ctx.status, use res.statusCode instead
        const status = ctx.respond === false ? ctx.res.statusCode : ctx.status;
        log.info('HTTP', `← ${ctx.method} ${ctx.path} ${status} ${ms}ms`);
    };
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function _optionalBasicAuthMiddleware(): Koa.Middleware {
    const enabled = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASS);

    return async (ctx, next) => {
        if (!enabled || ctx.path.startsWith('/v1/')) return next();

        const auth = ctx.get('authorization');
        if (!auth.startsWith('Basic ')) {
            ctx.set('WWW-Authenticate', 'Basic realm="neo", charset="UTF-8"');
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }

        const encoded = auth.slice('Basic '.length).trim();
        let decoded = '';
        try {
            decoded = Buffer.from(encoded, 'base64').toString('utf8');
        } catch {
            ctx.set('WWW-Authenticate', 'Basic realm="neo", charset="UTF-8"');
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }

        const idx = decoded.indexOf(':');
        if (idx < 0) {
            ctx.set('WWW-Authenticate', 'Basic realm="neo", charset="UTF-8"');
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }

        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);

        const userOk = _safeEqual(user, BASIC_AUTH_USER);
        const passOk = _safeEqual(pass, BASIC_AUTH_PASS);

        if (!userOk || !passOk) {
            ctx.set('WWW-Authenticate', 'Basic realm="neo", charset="UTF-8"');
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }

        return next();
    };
}

function _safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

function _authMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
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

        // Auth required for /api/* and /apps/* (per-user mini web apps).
        // Everything else is the public SPA shell / static frontend.
        const protectedPath = ctx.path.startsWith('/api/') || ctx.path.startsWith('/apps/');
        if (!protectedPath) return next();
        if (ctx.path === '/api/auth/login') return next();
        if (ctx.path.startsWith('/api/webhook/') || ctx.path.startsWith('/api/workflow-webhook/')) return next();

        const userId = ctx.cookies.get(SESSION_COOKIE, { signed: true });
        if (userId) {
            ctx.state.userId = userId;
            return next();
        }

        // For /apps/* serve a friendly HTML so users land on login;
        // /api/* keeps the existing JSON 401.
        if (ctx.path.startsWith('/apps/')) {
            ctx.status = 302;
            ctx.redirect('/');
            return;
        }

        ctx.status = 401;
        ctx.body = { error: 'Unauthorized' };
    };
}
