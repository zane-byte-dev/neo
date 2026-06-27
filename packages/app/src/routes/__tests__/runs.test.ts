import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';

const { mockWorkDir } = vi.hoisted(() => ({ mockWorkDir: { value: '' } }));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn(async (userId: string) => ({
        userId,
        workDir: mockWorkDir.value,
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    })),
}));

import { runsRoute } from '../runs.js';
import { createRun, saveRun, loadRun, appendEvent } from '@neo/runtime';

function buildApp(userId?: string): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    app.use(bodyParser());
    runsRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runs-route-'));
    mockWorkDir.value = workDir;
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runs API', () => {
    describe('GET /api/runs', () => {
        it('returns 401 without an authenticated user', async () => {
            const res = await request(buildApp().callback()).get('/api/runs');
            expect(res.status).toBe(401);
        });

        it('returns the user\'s runs newest first', async () => {
            const a = await createRun(workDir, {
                id: 'run_001',
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            const b = await createRun(workDir, {
                id: 'run_002',
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            const res = await request(buildApp('alice').callback()).get('/api/runs');
            expect(res.status).toBe(200);
            expect(res.body.runs.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
        });

        it('filters out runs owned by other users', async () => {
            await createRun(workDir, {
                id: 'run_other',
                userId: 'bob',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            const res = await request(buildApp('alice').callback()).get('/api/runs');
            expect(res.status).toBe(200);
            expect(res.body.runs).toEqual([]);
        });

        it('honours the limit query parameter', async () => {
            for (let i = 0; i < 5; i++) {
                await createRun(workDir, {
                    id: `run_${i.toString().padStart(3, '0')}`,
                    userId: 'alice',
                    entrypoint: 'web-chat',
                    triggerType: 'user_message',
                });
            }
            const res = await request(buildApp('alice').callback()).get('/api/runs?limit=2');
            expect(res.body.runs).toHaveLength(2);
        });
    });

    describe('GET /api/runs/:id', () => {
        it('returns 404 for unknown ids', async () => {
            const res = await request(buildApp('alice').callback()).get('/api/runs/missing');
            expect(res.status).toBe(404);
        });

        it('returns 403 when the run belongs to another user', async () => {
            await createRun(workDir, {
                id: 'run_other',
                userId: 'bob',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            const res = await request(buildApp('alice').callback()).get('/api/runs/run_other');
            expect(res.status).toBe(403);
        });

        it('returns the run record for the owning user', async () => {
            const run = await createRun(workDir, {
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                request: { message: 'hi' },
            });
            const res = await request(buildApp('alice').callback()).get(`/api/runs/${run.id}`);
            expect(res.status).toBe(200);
            expect(res.body.run.id).toBe(run.id);
            expect(res.body.run.request.message).toBe('hi');
        });
    });

    describe('GET /api/runs/:id/events', () => {
        it('returns events from cursor onward', async () => {
            const run = await createRun(workDir, {
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            await appendEvent(workDir, run.id, 'run_created', {
                status: 'queued',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            await appendEvent(workDir, run.id, 'run_started', {
                startedAt: new Date().toISOString(),
            });
            await appendEvent(workDir, run.id, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 0,
            });

            const res = await request(buildApp('alice').callback()).get(
                `/api/runs/${run.id}/events?cursor=0`,
            );
            expect(res.status).toBe(200);
            expect(res.body.events.map((e: { type: string }) => e.type)).toEqual([
                'run_started',
                'run_completed',
            ]);
            expect(res.body.nextCursor).toBe(2);
        });

        it('supports reconnect by reusing nextCursor across paged reads', async () => {
            const run = await createRun(workDir, {
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            await appendEvent(workDir, run.id, 'run_created', {
                status: 'queued',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            await appendEvent(workDir, run.id, 'llm_chunk', {
                chunkType: 'text',
                text: 'hello',
            });
            await appendEvent(workDir, run.id, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 5,
                outputPreview: 'hello',
            });

            const first = await request(buildApp('alice').callback()).get(
                `/api/runs/${run.id}/events?cursor=-1&limit=2`,
            );
            expect(first.status).toBe(200);
            expect(first.body.events.map((e: { type: string }) => e.type)).toEqual([
                'run_created',
                'llm_chunk',
            ]);
            expect(first.body.nextCursor).toBe(1);

            const second = await request(buildApp('alice').callback()).get(
                `/api/runs/${run.id}/events?cursor=${first.body.nextCursor}&limit=2`,
            );
            expect(second.status).toBe(200);
            expect(second.body.events.map((e: { type: string }) => e.type)).toEqual([
                'run_completed',
            ]);
            expect(second.body.nextCursor).toBe(2);

            const tail = await request(buildApp('alice').callback()).get(
                `/api/runs/${run.id}/events?cursor=${second.body.nextCursor}&limit=2`,
            );
            expect(tail.status).toBe(200);
            expect(tail.body.events).toEqual([]);
            expect(tail.body.nextCursor).toBe(2);
        });

        it('rejects access from other users', async () => {
            const run = await createRun(workDir, {
                id: 'r1',
                userId: 'bob',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
            });
            const res = await request(buildApp('alice').callback()).get(
                `/api/runs/${run.id}/events`,
            );
            expect(res.status).toBe(403);
        });
    });

    describe('POST /api/runs/:id/cancel', () => {
        it('writes cancelRequested into metadata', async () => {
            const run = await createRun(workDir, {
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                status: 'running',
            });
            const res = await request(buildApp('alice').callback()).post(
                `/api/runs/${run.id}/cancel`,
            );
            expect(res.status).toBe(200);
            const after = await loadRun(workDir, run.id);
            expect(after?.metadata?.cancelRequested).toBe(true);
        });

        it('is a no-op for terminal runs', async () => {
            const run = await createRun(workDir, {
                userId: 'alice',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                status: 'completed',
            });
            // Backdate to ensure terminal.
            await saveRun(workDir, { ...run, status: 'completed' });
            const res = await request(buildApp('alice').callback()).post(
                `/api/runs/${run.id}/cancel`,
            );
            expect(res.status).toBe(200);
            expect(res.body.alreadyTerminal).toBe(true);
            const after = await loadRun(workDir, run.id);
            expect(after?.metadata?.cancelRequested).toBeUndefined();
        });

        it('returns 403 for cross-user cancel', async () => {
            await createRun(workDir, {
                id: 'run_other',
                userId: 'bob',
                entrypoint: 'web-chat',
                triggerType: 'user_message',
                status: 'running',
            });
            const res = await request(buildApp('alice').callback()).post(
                '/api/runs/run_other/cancel',
            );
            expect(res.status).toBe(403);
        });
    });
});
