import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockDirs } = vi.hoisted(() => ({
    mockDirs: { workDir: '', stateDir: '' },
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn(async (userId: string) => ({
        userId,
        workDir: mockDirs.workDir,
        stateDir: mockDirs.stateDir,
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    })),
}));

import { userAppsRoute } from '../user-apps.js';

function buildApp(userId?: string): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    userAppsRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

let tempRoot: string;
let workDir: string;
let stateDir: string;

beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'neo-user-apps-'));
    workDir = join(tempRoot, 'project');
    stateDir = join(tempRoot, 'state');
    mkdirSync(workDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mockDirs.workDir = workDir;
    mockDirs.stateDir = stateDir;
});

afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});

describe('user apps routes', () => {
    it('lists apps from stateDir/apps instead of workDir/apps', async () => {
        mkdirSync(join(workDir, 'apps', 'workspace-only'), { recursive: true });
        writeFileSync(join(workDir, 'apps', 'workspace-only', 'index.html'), '<h1>workspace</h1>');

        mkdirSync(join(stateDir, 'apps', 'state-app'), { recursive: true });
        writeFileSync(join(stateDir, 'apps', 'state-app', 'index.html'), '<h1>state</h1>');
        writeFileSync(
            join(stateDir, 'apps', 'state-app', 'manifest.json'),
            JSON.stringify({ title: 'State App', description: 'served from stateDir' }),
        );

        const res = await request(buildApp('alice').callback()).get('/api/apps');

        expect(res.status).toBe(200);
        expect(res.body.apps).toHaveLength(1);
        expect(res.body.apps[0]).toMatchObject({
            name: 'state-app',
            title: 'State App',
            description: 'served from stateDir',
            hasIndex: true,
        });
    });

    it('serves static app assets from stateDir/apps', async () => {
        mkdirSync(join(workDir, 'apps', 'demo'), { recursive: true });
        writeFileSync(join(workDir, 'apps', 'demo', 'index.html'), '<h1>workspace</h1>');

        mkdirSync(join(stateDir, 'apps', 'demo'), { recursive: true });
        writeFileSync(join(stateDir, 'apps', 'demo', 'index.html'), '<h1>state</h1>');
        writeFileSync(join(stateDir, 'apps', 'demo', 'style.css'), 'body { color: red; }');

        const indexRes = await request(buildApp('alice').callback()).get('/apps/demo/');
        expect(indexRes.status).toBe(200);
        expect(indexRes.text).toContain('<h1>state</h1>');

        const cssRes = await request(buildApp('alice').callback()).get('/apps/demo/style.css');
        expect(cssRes.status).toBe(200);
        expect(cssRes.text).toContain('color: red');
    });
});