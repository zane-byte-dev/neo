import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from './test-helpers.js';

describe('Auth middleware', () => {
    it('non /api/ paths do not require auth', async () => {
        const { app, router, mount } = createTestApp();
        router.get('/health', (ctx) => { ctx.body = { ok: true }; });
        mount();

        const res = await request(app.callback()).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('/api/auth/login does not require auth', async () => {
        const { app, router, mount } = createTestApp();
        router.post('/api/auth/login', (ctx) => { ctx.body = { ok: true }; });
        mount();

        const res = await request(app.callback()).post('/api/auth/login').send({});
        expect(res.status).toBe(200);
    });

    it('returns 401 for /api/* without cookie', async () => {
        const { app, router, mount } = createTestApp();
        router.get('/api/me', (ctx) => { ctx.body = { user: ctx.state.userId }; });
        mount();

        const res = await request(app.callback()).get('/api/me');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    it('passes with valid signed cookie', async () => {
        const { app, router, mount } = createTestApp();
        router.get('/api/me', (ctx) => { ctx.body = { user: ctx.state.userId }; });
        mount();

        const cookie = signedCookie('testuser');
        const res = await request(app.callback())
            .get('/api/me')
            .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.user).toBe('testuser');
    });

    it('returns 401 for Basic Auth when no Authorization header', async () => {
        const { app, router, mount } = createTestApp({
            basicAuthUser: 'admin',
            basicAuthPass: 'secret',
        });
        router.get('/health', (ctx) => { ctx.body = { ok: true }; });
        mount();

        const res = await request(app.callback()).get('/health');
        expect(res.status).toBe(401);
    });

    it('passes Basic Auth with correct credentials', async () => {
        const { app, router, mount } = createTestApp({
            basicAuthUser: 'admin',
            basicAuthPass: 'secret',
        });
        router.get('/api/auth/login', (ctx) => { ctx.body = { ok: true }; });
        mount();

        const creds = Buffer.from('admin:secret').toString('base64');
        const res = await request(app.callback())
            .get('/api/auth/login')
            .set('Authorization', `Basic ${creds}`);
        expect(res.status).toBe(200);
    });

    it('returns 401 for Basic Auth with wrong credentials', async () => {
        const { app, router, mount } = createTestApp({
            basicAuthUser: 'admin',
            basicAuthPass: 'secret',
        });
        router.get('/health', (ctx) => { ctx.body = { ok: true }; });
        mount();

        const creds = Buffer.from('admin:wrong').toString('base64');
        const res = await request(app.callback())
            .get('/health')
            .set('Authorization', `Basic ${creds}`);
        expect(res.status).toBe(401);
    });
});
