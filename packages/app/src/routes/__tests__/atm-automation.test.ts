import { bodyParser } from '@koa/bodyparser';
import Router from '@koa/router';
import Koa from 'koa';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { atmAutomation } from '../atm-automation.js';

function appWith(fetchImpl: typeof fetch, baseUrl = 'http://127.0.0.1:7070') {
    const app = new Koa();
    const router = new Router();
    app.use(bodyParser());
    atmAutomation(router, { fetch: fetchImpl, baseUrl });
    app.use(router.routes());
    return app.callback();
}

describe('ATM automation proxy', () => {
    it('proxies schedule reads and writes to the configured loopback ATM', async () => {
        const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/v1/schedules') && init?.method === 'PUT') {
                return new Response(JSON.stringify({ error: 'unexpected method' }), { status: 500 });
            }
            return new Response(JSON.stringify(url.endsWith('/v1/schedules') ? [] : { id: 'demo' }), {
                status: init?.method === 'POST' ? 200 : 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as unknown as typeof fetch;
        const app = appWith(fetchImpl, 'http://localhost:17070');

        await request(app).get('/api/atm/schedules').expect(200, []);
        await request(app)
            .post('/api/atm/schedules')
            .send({ schemaVersion: 1, id: 'demo' })
            .expect(200);

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const [, secondInit] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [URL, RequestInit];
        expect(secondInit.method).toBe('POST');
        expect(JSON.parse(String(secondInit.body))).toMatchObject({ id: 'demo' });
    });

    it('keeps ATM failures behind a 503 boundary', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
        await request(appWith(fetchImpl)).get('/api/atm/health').expect(503, { error: 'ATM is unavailable' });
    });

    it('rejects non-loopback ATM configuration', async () => {
        const fetchImpl = vi.fn() as unknown as typeof fetch;
        await request(appWith(fetchImpl, 'https://example.com')).get('/api/atm/schedules').expect(503, { error: 'ATM is unavailable' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
