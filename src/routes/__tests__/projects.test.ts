import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_USER = 'projects-route-user';
const ORIGINAL_USERS_ENV = process.env.USERS;

let stateDir: string;
let extDir: string;

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

let newProjects: typeof import('../projects.js').newProjects;

beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'projroute-state-'));
    extDir = mkdtempSync(join(tmpdir(), 'projroute-ext-'));
    process.env.USERS = JSON.stringify([
        { id: TEST_USER, name: 'T', workDir: stateDir, stateDir },
    ]);
    const mod = await import('../projects.js');
    newProjects = mod.newProjects;
});

afterEach(async () => {
    if (ORIGINAL_USERS_ENV === undefined) delete process.env.USERS;
    else process.env.USERS = ORIGINAL_USERS_ENV;
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(extDir, { recursive: true, force: true }).catch(() => {});
});

describe('/api/projects', () => {
    it('GET requires auth', async () => {
        const app = buildApp(newProjects);
        const res = await request(app.callback()).get('/api/projects');
        expect(res.status).toBe(401);
    });

    it('GET returns empty list initially', async () => {
        const app = buildApp(newProjects, TEST_USER);
        const res = await request(app.callback()).get('/api/projects');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ projects: [] });
    });

    it('POST registers a new project', async () => {
        const app = buildApp(newProjects, TEST_USER);
        const res = await request(app.callback())
            .post('/api/projects')
            .send({ path: extDir, name: 'My Proj' });
        expect(res.status).toBe(200);
        expect(res.body.path).toBe(extDir);
        expect(res.body.name).toBe('My Proj');

        const list = await request(app.callback()).get('/api/projects');
        expect(list.body.projects).toHaveLength(1);
    });

    it('POST rejects missing path', async () => {
        const app = buildApp(newProjects, TEST_USER);
        const res = await request(app.callback()).post('/api/projects').send({});
        expect(res.status).toBe(400);
    });

    it('POST rejects non-existent directory', async () => {
        const app = buildApp(newProjects, TEST_USER);
        const res = await request(app.callback())
            .post('/api/projects')
            .send({ path: '/no/such/dir-zzz-xyz' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/does not exist/);
    });

    it('DELETE removes a project', async () => {
        const app = buildApp(newProjects, TEST_USER);
        const created = await request(app.callback())
            .post('/api/projects')
            .send({ path: extDir });
        expect(created.status).toBe(200);
        const id = created.body.id;

        const del = await request(app.callback()).delete(`/api/projects/${id}`);
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ ok: true });

        const list = await request(app.callback()).get('/api/projects');
        expect(list.body.projects).toEqual([]);
    });
});
