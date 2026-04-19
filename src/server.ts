import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { timingSafeEqual } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

import { SESSION_SECRET } from './config.js';
import { setupTools } from './tools/index.js';
import { setupRoutes } from './routes/index.js';
import { SESSION_COOKIE } from './const/cookie.js';

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

        const app = new Koa();
        app.keys = [SESSION_SECRET!];
        const router = new Router();

        app.use(_optionalBasicAuthMiddleware());
        app.use(_authMiddleware());
        app.use(bodyParser({ jsonLimit: '20mb' }));

        await setupRoutes(router);

        app.use(router.routes());
        app.use(router.allowedMethods());

        // Serve built frontend static files (production)
        const distDir = join(__dirname, '../web/dist');
        app.use(serve(distDir));

        // SPA fallback: serve index.html for non-API routes (client-side routing)
        app.use(async (ctx) => {
            if (ctx.status === 404 && !ctx.path.startsWith('/api/')) {
                try {
                    ctx.type = 'html';
                    ctx.body = await readFile(join(distDir, 'index.html'));
                } catch { /* index.html missing – dev mode, ignore */ }
            }
        });

        this.httpServer = app.listen(WEB_PORT, () => {
            console.log(`[CoreServer] 🌐 http://localhost:${WEB_PORT}`);
        });
    }

    async shutdown(): Promise<void> {
        await new Promise<void>((res) => {
            if (this.httpServer) this.httpServer.close(() => res());
            else res();
        });
    }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function _optionalBasicAuthMiddleware(): Koa.Middleware {
    const enabled = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASS);

    return async (ctx, next) => {
        if (!enabled) return next();

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
        // Skip non-API paths and the login endpoint itself
        if (!ctx.path.startsWith('/api/')) return next();
        if (ctx.path === '/api/auth/login') return next();

        const userId = ctx.cookies.get(SESSION_COOKIE, { signed: true });
        if (userId) {
            ctx.state.userId = userId;
            return next();
        }

        ctx.status = 401;
        ctx.body = { error: 'Unauthorized' };
    };
}
