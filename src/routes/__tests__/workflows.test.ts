import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const state = vi.hoisted(() => ({
    root: '',
    webhookSecret: 'secret-123',
}));

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn(async (userId: string) => ({
        userId,
        workDir: state.root,
        stateDir: state.root,
        systemInstruction: '',
        skillRegistry: { get: vi.fn(), list: vi.fn(() => []) },
        userTools: new Map(),
    })),
    getWebhookSecret: vi.fn(() => state.webhookSecret),
}));

vi.mock('../../services/agent-runner.js', () => ({
    runAgentTurn: vi.fn(),
}));

import { workflowRoute } from '../workflows.js';

const cookie = signedCookie('alice');

function buildApp() {
    const { app, router, mount } = createTestApp();
    workflowRoute(router);
    mount();
    return app;
}

describe('workflow routes', () => {
    beforeEach(() => {
        state.root = mkdtempSync(join(tmpdir(), 'neo-workflow-routes-'));
        state.webhookSecret = 'secret-123';
        vi.clearAllMocks();
    });

    afterEach(() => {
        rmSync(state.root, { recursive: true, force: true });
    });

    it('creates, lists and manually runs a workflow', async () => {
        const app = buildApp();
        const workflow = {
            name: 'Two step workflow',
            enabled: true,
            trigger: { type: 'manual' },
            steps: [
                { id: 'first', type: 'transform', template: 'Hello {{input.name}}' },
                { id: 'second', type: 'transform', template: '{{previous}}!' },
            ],
        };

        const save = await request(app.callback())
            .put('/api/workflows/hello')
            .set('Cookie', cookie)
            .send(workflow);
        expect(save.status).toBe(200);
        expect(save.body.workflow.id).toBe('hello');

        const run = await request(app.callback())
            .post('/api/workflows/hello/run')
            .set('Cookie', cookie)
            .send({ input: { name: 'Neo' } });
        expect(run.status).toBe(200);
        expect(run.body.ok).toBe(true);
        expect(run.body.run.output).toBe('Hello Neo!');

        const list = await request(app.callback())
            .get('/api/workflows')
            .set('Cookie', cookie);
        expect(list.status).toBe(200);
        expect(list.body.workflows[0].lastRun.status).toBe('success');
    });
});