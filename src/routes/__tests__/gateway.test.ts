import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

let previousUsers: string | undefined;
let previousWebPort: string | undefined;
let stateDir: string;

beforeEach(() => {
    previousUsers = process.env.USERS;
    previousWebPort = process.env.WEB_PORT;
    stateDir = mkdtempSync(join(tmpdir(), 'gateway-route-settings-'));
    process.env.USERS = JSON.stringify([{ id: 'u1', name: 'User', workDir: stateDir, stateDir }]);
});

afterEach(() => {
    if (previousUsers === undefined) delete process.env.USERS;
    else process.env.USERS = previousUsers;
    if (previousWebPort === undefined) delete process.env.WEB_PORT;
    else process.env.WEB_PORT = previousWebPort;
    rmSync(stateDir, { recursive: true, force: true });
});

async function app() {
    const { gateway } = await import('../gateway.js');
    const testApp = createTestApp();
    gateway(testApp.router);
    testApp.mount();
    return testApp.app.callback();
}

describe('/api/gateway', () => {
    it('requires a signed web session', async () => {
        const res = await request(await app()).get('/api/gateway');
        expect(res.status).toBe(401);
    });

    it('generates, masks, rotates, and disables a gateway token', async () => {
        const cookie = signedCookie('u1');
        const server = await app();

        const initial = await request(server).get('/api/gateway').set('Cookie', cookie);
        expect(initial.status).toBe(200);
        expect(initial.body.gateway).toMatchObject({ enabled: false, configured: false, source: 'none' });

        const enabled = await request(server).post('/api/gateway').set('Cookie', cookie).send({ enabled: true });
        expect(enabled.status).toBe(200);
        expect(enabled.body.gateway).toMatchObject({ enabled: true, configured: true, source: 'state' });
        expect(enabled.body.gateway.token).toMatch(/^[a-f0-9]{64}$/);

        const reloaded = await request(server).get('/api/gateway').set('Cookie', cookie);
        expect(reloaded.body.gateway.token).toBeUndefined();
        expect(reloaded.body.gateway.masked).toBe(`••••${enabled.body.gateway.token.slice(-6)}`);

        const rotated = await request(server).post('/api/gateway').set('Cookie', cookie).send({ enabled: true, rotate: true });
        expect(rotated.body.gateway.token).toMatch(/^[a-f0-9]{64}$/);
        expect(rotated.body.gateway.token).not.toBe(enabled.body.gateway.token);

        const disabled = await request(server).post('/api/gateway').set('Cookie', cookie).send({ enabled: false });
        expect(disabled.body.gateway).toMatchObject({ enabled: false, configured: false, source: 'state' });
    });

    it('returns backend WEB_PORT base URL when host is vite dev server', async () => {
        process.env.WEB_PORT = '3000';
        const cookie = signedCookie('u1');
        const res = await request(await app())
            .get('/api/gateway')
            .set('Cookie', cookie)
            .set('Host', 'localhost:5173');
        expect(res.status).toBe(200);
        expect(res.body.gateway.baseUrl).toBe('http://localhost:3000/v1');
    });
});
