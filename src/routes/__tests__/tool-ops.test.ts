import { describe, it, expect, beforeEach } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';
import { toolConfirmRoute } from '../tool-confirm.js';
import { toolResultRoute } from '../tool-result.js';
import { toolStatsRoute } from '../tool-stats.js';
import { createConfirm, _resetPending } from '../../utils/pending-confirm.js';
import { resetToolResultCache, setToolResult } from '../../utils/tool-result-cache.js';
import { recordToolCall, resetToolStats } from '../../utils/tool-stats.js';

function buildApp(registerRoute: (router: Router) => void, userId?: string): Koa {
    const app = new Koa();
    const router = new Router();

    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    app.use(bodyParser());
    registerRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

describe('tool operation routes', () => {
    beforeEach(() => {
        _resetPending();
        resetToolResultCache();
        resetToolStats();
    });

    describe('POST /api/tool-confirm', () => {
        it('returns 401 without authenticated user', async () => {
            const app = buildApp(toolConfirmRoute);

            const res = await request(app.callback())
                .post('/api/tool-confirm')
                .send({ confirmId: 'abc', approved: true });

            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'unauthorized' });
        });

        it('returns 400 when confirmId is missing', async () => {
            const app = buildApp(toolConfirmRoute, 'user-1');

            const res = await request(app.callback())
                .post('/api/tool-confirm')
                .send({ approved: true });

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'confirmId required' });
        });

        it('returns 404 for unknown or expired confirmId', async () => {
            const app = buildApp(toolConfirmRoute, 'user-1');

            const res = await request(app.callback())
                .post('/api/tool-confirm')
                .send({ confirmId: 'missing', approved: true });

            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: 'unknown or expired confirmId' });
        });

        it('resolves a pending confirmation for the matching user', async () => {
            const app = buildApp(toolConfirmRoute, 'user-1');
            const { confirmId, promise } = createConfirm('user-1');

            const res = await request(app.callback())
                .post('/api/tool-confirm')
                .send({ confirmId, approved: true });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
            await expect(promise).resolves.toBe(true);
        });
    });

    describe('GET /api/tool-result/:id', () => {
        it('returns 401 without authenticated user', async () => {
            const app = buildApp(toolResultRoute);

            const res = await request(app.callback())
                .get('/api/tool-result/abc');

            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'unauthorized' });
        });

        it('returns 404 when result id is not found', async () => {
            const app = buildApp(toolResultRoute, 'user-1');

            const res = await request(app.callback())
                .get('/api/tool-result/missing');

            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: 'not_found' });
        });

        it('returns 403 when result belongs to another user', async () => {
            setToolResult('r1', { userId: 'owner', toolName: 'bash', result: 'secret' });
            const app = buildApp(toolResultRoute, 'other-user');

            const res = await request(app.callback())
                .get('/api/tool-result/r1');

            expect(res.status).toBe(403);
            expect(res.body).toEqual({ error: 'forbidden' });
        });

        it('returns the stored result for the owning user', async () => {
            setToolResult('r1', { userId: 'user-1', toolName: 'bash', result: 'full output' });
            const app = buildApp(toolResultRoute, 'user-1');

            const res = await request(app.callback())
                .get('/api/tool-result/r1');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('r1');
            expect(res.body.toolName).toBe('bash');
            expect(res.body.result).toBe('full output');
            expect(res.body.createdAt).toBeTypeOf('number');
        });
    });

    describe('GET /api/tool-stats', () => {
        it('returns 401 without authenticated user', async () => {
            const app = buildApp(toolStatsRoute);

            const res = await request(app.callback())
                .get('/api/tool-stats');

            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'unauthorized' });
        });

        it('returns in-memory tool statistics for authenticated users', async () => {
            recordToolCall('bash', 'success', 10);
            recordToolCall('bash', 'error', 20);
            recordToolCall('read_file', 'success', 5);

            const app = buildApp(toolStatsRoute, 'user-1');
            const res = await request(app.callback())
                .get('/api/tool-stats');

            expect(res.status).toBe(200);
            expect(res.body.totalCalls).toBe(3);
            expect(Array.isArray(res.body.tools)).toBe(true);
            expect(res.body.tools[0].name).toBe('bash');
            expect(res.body.tools[0].total).toBe(2);
            expect(res.body.tools[0].success).toBe(1);
            expect(res.body.tools[0].error).toBe(1);
            expect(res.body.tools[0].avgDurationMs).toBe(15);
        });
    });
});