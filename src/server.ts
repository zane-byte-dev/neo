import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import serve from 'koa-static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { SESSION_SECRET } from './config.js';
import { initDb } from './services/db.js';
import { setupTools } from './tools/index.js';
import { setupRoutes } from './routes/index.js';
import { SESSION_COOKIE } from './const/cookie.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);

export class CoreServer {
    /** Registered platform clients (telegram, feishu, …) */
    private httpServer?: ReturnType<Koa['listen']>;

    async start(): Promise<void> {
        initDb();
        await setupTools();

        const app = new Koa();
        app.keys = [SESSION_SECRET];
        const router = new Router();

        app.use(_authMiddleware());
        app.use(bodyParser());

        await setupRoutes(router);

        app.use(router.routes());
        app.use(router.allowedMethods());

        // Serve built frontend static files (production)
        const distDir = join(__dirname, '../web/dist');
        app.use(serve(distDir));

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
