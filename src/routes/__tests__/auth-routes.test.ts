/**
 * Tests for /api/auth/login and /api/auth/logout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../__tests__/test-helpers.js';
import { SESSION_COOKIE } from '../../const/cookie.js';

const userGetByWebTokenMock = vi.fn();

vi.mock('../../services/user-service.js', () => ({
    userGetByWebToken: userGetByWebTokenMock,
}));

beforeEach(() => userGetByWebTokenMock.mockReset());

describe('POST /api/auth/login', () => {
    it('returns 401 when token is invalid', async () => {
        userGetByWebTokenMock.mockReturnValue(undefined);
        const { login } = await import('../user.js');
        const { app, router, mount } = createTestApp();
        login(router); mount();
        const res = await request(app.callback()).post('/api/auth/login').send({ token: 'bad' });
        expect(res.status).toBe(401);
    });

    it('returns 401 when token is empty/missing', async () => {
        const { login } = await import('../user.js');
        const { app, router, mount } = createTestApp();
        login(router); mount();
        const res = await request(app.callback()).post('/api/auth/login').send({});
        expect(res.status).toBe(401);
    });

    it('sets a signed session cookie on valid token', async () => {
        userGetByWebTokenMock.mockReturnValue({ id: 'u1', name: 'Alice' });
        const { login } = await import('../user.js');
        const { app, router, mount } = createTestApp();
        login(router); mount();
        const res = await request(app.callback()).post('/api/auth/login').send({ token: 'good' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, userId: 'u1' });
        const setCookies = res.headers['set-cookie'] as unknown as string[];
        expect(setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=u1`))).toBe(true);
    });
});

describe('POST /api/auth/logout', () => {
    it('clears the session cookie', async () => {
        const { logout } = await import('../user.js');
        const { signedCookie } = await import('../../__tests__/test-helpers.js');
        const { app, router, mount } = createTestApp();
        logout(router); mount();
        const res = await request(app.callback())
            .post('/api/auth/logout')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        const setCookies = res.headers['set-cookie'] as unknown as string[];
        // cookie cleared (empty value)
        expect(setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    });
});
