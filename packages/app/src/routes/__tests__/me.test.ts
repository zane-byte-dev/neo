import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { me, initWorkspace } from '../me.js';
import { invalidateUserCache } from '@neo/agent/services/user-service.js';

let previousUsers: string | undefined;
let tempRoot: string;
let workDir: string;
let stateDir: string;

function buildApp(userId?: string): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    me(router);
    initWorkspace(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

beforeEach(() => {
    previousUsers = process.env.USERS;
    tempRoot = mkdtempSync(join(tmpdir(), 'neo-me-route-'));
    workDir = join(tempRoot, 'workspace');
    stateDir = join(tempRoot, 'state');
    process.env.USERS = JSON.stringify([
        {
            id: 'alice',
            name: 'Alice',
            workDir,
            stateDir,
        },
    ]);
    invalidateUserCache('alice');
});

afterEach(() => {
    invalidateUserCache('alice');
    if (previousUsers === undefined) delete process.env.USERS;
    else process.env.USERS = previousUsers;
    rmSync(tempRoot, { recursive: true, force: true });
});

describe('me routes', () => {
    it('returns the current user profile from /api/me', async () => {
        const res = await request(buildApp('alice').callback()).get('/api/me');

        expect(res.status).toBe(200);
        expect(res.body.userId).toBe('alice');
        expect(res.body.profile).toContain('# USER');
    });

    it('initializes the workspace explicitly from /api/me/workspace/init', async () => {
        const res = await request(buildApp('alice').callback()).post('/api/me/workspace/init');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.userId).toBe('alice');
        expect(res.body.profile).toContain('# USER');
    });

    it('rejects workspace init when unauthenticated', async () => {
        const res = await request(buildApp().callback()).post('/api/me/workspace/init');

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });
});