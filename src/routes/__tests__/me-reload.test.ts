/**
 * Tests for the small auth/maintenance routes: /api/me and /api/reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const invalidateCalls: string[] = [];

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn().mockResolvedValue({
        workDir: '/tmp/work',
        userProfile: {
            read: vi.fn().mockResolvedValue('- 姓名: Alice\n- city: Hangzhou\n'),
        },
    }),
    invalidateUserCache: vi.fn((userId?: string) => {
        invalidateCalls.push(userId ?? '__all__');
    }),
}));

beforeEach(() => {
    invalidateCalls.length = 0;
});

describe('GET /api/me', () => {
    it('returns 401 when no auth cookie is present', async () => {
        const { me } = await import('../me.js');
        const { app, router, mount } = createTestApp();
        me(router);
        mount();
        const res = await request(app.callback()).get('/api/me');
        expect(res.status).toBe(401);
    });

    it('extracts displayName from the user profile markdown', async () => {
        const { me } = await import('../me.js');
        const { app, router, mount } = createTestApp();
        me(router);
        mount();
        const res = await request(app.callback())
            .get('/api/me')
            .set('Cookie', signedCookie('user-1'));
        expect(res.status).toBe(200);
        expect(res.body.userId).toBe('user-1');
        expect(res.body.displayName).toBe('Alice');
        expect(res.body.profile).toContain('姓名');
    });
});

describe('POST /api/reload', () => {
    it('invalidates the authenticated user cache', async () => {
        const { reloadRoute } = await import('../reload.js');
        const { app, router, mount } = createTestApp();
        reloadRoute(router);
        mount();
        const res = await request(app.callback())
            .post('/api/reload')
            .set('Cookie', signedCookie('user-1'));
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.message).toContain('user-1');
        expect(invalidateCalls).toEqual(['user-1']);
    });

    it('invalidates a specific user via /api/reload/:userId (auth required)', async () => {
        const { reloadRoute } = await import('../reload.js');
        const { app, router, mount } = createTestApp();
        reloadRoute(router);
        mount();
        const res = await request(app.callback())
            .post('/api/reload/user-42')
            .set('Cookie', signedCookie('admin'));
        expect(res.status).toBe(200);
        expect(res.body.message).toContain('user-42');
        expect(invalidateCalls).toEqual(['user-42']);
    });

    it('returns 401 without auth', async () => {
        const { reloadRoute } = await import('../reload.js');
        const { app, router, mount } = createTestApp();
        reloadRoute(router);
        mount();
        const res = await request(app.callback()).post('/api/reload');
        expect(res.status).toBe(401);
    });
});
