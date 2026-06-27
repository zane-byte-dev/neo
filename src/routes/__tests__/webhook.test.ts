import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockWorkDir, mockSecret } = vi.hoisted(() => ({
    mockWorkDir: { value: '' },
    mockSecret: { value: 'secret-123' },
}));

vi.mock('../../app/agent-runtime.js', () => ({
    neoAgentRuntime: {
        startRun: vi.fn(),
    },
}));

vi.mock('../../services/user-service.js', () => ({
    getWebhookSecret: vi.fn(() => mockSecret.value),
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

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

import { webhookRoute } from '../webhook.js';
import { neoAgentRuntime } from '../../app/agent-runtime.js';
import { createRun, appendEvent } from '@neo/runtime';

function buildApp(): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(bodyParser());
    webhookRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

let workDir: string;

describe('POST /api/webhook/:userId', () => {
    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'neo-webhook-'));
        mockWorkDir.value = workDir;
        mockSecret.value = 'secret-123';
        vi.clearAllMocks();
    });

    afterEach(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('returns artifacts collected from runtime events', async () => {
        vi.mocked(neoAgentRuntime.startRun).mockImplementation(async (opts) => {
            const runId = opts.runId ?? 'run_webhook_test';
            await createRun(workDir, {
                id: runId,
                userId: 'alice',
                entrypoint: 'webhook',
                triggerType: 'webhook_call',
                sessionId: opts.sessionId,
                request: { message: opts.message },
            });
            await appendEvent(workDir, runId, 'artifact_created', {
                artifact: {
                    id: 'art_1',
                    runId,
                    kind: 'video',
                    createdAt: new Date().toISOString(),
                    url: 'https://example.com/demo.mp4',
                    title: 'Demo video',
                },
            });
            await appendEvent(workDir, runId, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 5,
                outputPreview: 'hello',
            });
            return { runId, output: 'hello' };
        });

        const res = await request(buildApp().callback())
            .post('/api/webhook/alice')
            .send({ message: 'hi', secret: 'secret-123', sessionId: 'sess1' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.runId).toBe(res.body.artifacts[0].runId);
        expect(res.body.response).toBe('hello');
        expect(res.body.artifacts).toHaveLength(1);
        expect(res.body.artifacts[0].url).toBe('https://example.com/demo.mp4');
    });
});
