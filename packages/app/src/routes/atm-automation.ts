import type Router from '@koa/router';
import type { Context } from 'koa';

const DEFAULT_ATM_URL = 'http://127.0.0.1:7070';

type FetchLike = typeof fetch;

export interface AtmAutomationRouteDeps {
    fetch: FetchLike;
    baseUrl: string;
}

const defaultDeps: AtmAutomationRouteDeps = {
    fetch: globalThis.fetch,
    baseUrl: process.env.ATM_HTTP_URL ?? DEFAULT_ATM_URL,
};

function assertLoopbackBaseUrl(value: string): URL {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname)) {
        throw new Error('ATM_HTTP_URL must be an http:// loopback URL');
    }
    return parsed;
}

async function proxyATM(
    ctx: Context,
    deps: AtmAutomationRouteDeps,
    path: string,
): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const base = assertLoopbackBaseUrl(deps.baseUrl);
        const target = new URL(path, base);
        const method = ctx.method.toUpperCase();
        const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
        const response = await deps.fetch(target, {
            method,
            signal: controller.signal,
            headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
            body: hasBody ? JSON.stringify(ctx.request.body ?? {}) : undefined,
        });
        const text = await response.text();
        ctx.status = response.status;
        ctx.type = 'application/json';
        try {
            ctx.body = text ? JSON.parse(text) : null;
        } catch {
            ctx.status = 502;
            ctx.body = { error: 'ATM returned a non-JSON response' };
        }
    } catch (error) {
        ctx.status = 503;
        ctx.body = {
            error: error instanceof Error && error.name === 'AbortError'
                ? 'ATM request timed out'
                : 'ATM is unavailable',
        };
    } finally {
        clearTimeout(timeout);
    }
}

export function atmAutomation(router: Router, deps: AtmAutomationRouteDeps = defaultDeps): void {
    router.get('/api/atm/health', (ctx) => proxyATM(ctx, deps, '/health'));
    router.get('/api/atm/schedules', (ctx) => proxyATM(ctx, deps, '/v1/schedules'));
    router.post('/api/atm/schedules', (ctx) => proxyATM(ctx, deps, '/v1/schedules'));
    router.get('/api/atm/schedules/:id', (ctx) => proxyATM(ctx, deps, `/v1/schedules/${encodeURIComponent(ctx.params.id)}`));
    router.put('/api/atm/schedules/:id', (ctx) => proxyATM(ctx, deps, `/v1/schedules/${encodeURIComponent(ctx.params.id)}`));
    router.delete('/api/atm/schedules/:id', (ctx) => proxyATM(ctx, deps, `/v1/schedules/${encodeURIComponent(ctx.params.id)}`));
    router.post('/api/atm/schedules/:id/run', (ctx) => proxyATM(ctx, deps, `/v1/schedules/${encodeURIComponent(ctx.params.id)}/run`));
    router.get('/api/atm/runs', (ctx) => {
        const query = new URLSearchParams();
        if (typeof ctx.query.scheduleId === 'string') query.set('scheduleId', ctx.query.scheduleId);
        if (typeof ctx.query.limit === 'string') query.set('limit', ctx.query.limit);
        const suffix = query.size ? `?${query.toString()}` : '';
        return proxyATM(ctx, deps, `/v1/runs${suffix}`);
    });
    router.get('/api/atm/runs/:id', (ctx) => proxyATM(ctx, deps, `/v1/runs/${encodeURIComponent(ctx.params.id)}`));
    router.get('/api/atm/runs/:id/events', (ctx) => proxyATM(ctx, deps, `/v1/runs/${encodeURIComponent(ctx.params.id)}/events`));
}
