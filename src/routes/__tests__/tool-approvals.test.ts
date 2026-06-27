import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockWorkDir } = vi.hoisted(() => ({
    mockWorkDir: { value: '' },
}));

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn(async (userId: string) => ({
        userId,
        workDir: mockWorkDir.value,
        stateDir: mockWorkDir.value,
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    })),
}));

import { toolApprovalsRoute } from '../tool-approvals.js';
import { saveToolApproval } from '@neo/runtime';

function buildApp(userId?: string): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    app.use(bodyParser());
    toolApprovalsRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-tool-approvals-'));
    mockWorkDir.value = workDir;
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('GET/DELETE /api/tool-approvals', () => {
    it('lists stored approval rules', async () => {
        await saveToolApproval(workDir, {
            toolName: 'bash',
            args: { command: 'echo hello' },
            scope: 'always',
        });

        const res = await request(buildApp('alice').callback())
            .get('/api/tool-approvals');

        expect(res.status).toBe(200);
        expect(res.body.rules).toHaveLength(1);
        expect(res.body.rules[0].toolName).toBe('bash');
        expect(res.body.rules[0].scope).toBe('always');
        expect(res.body.rules[0].matchMode).toBe('tool');
        expect(res.body.rules[0].args.command).toBe('echo hello');
    });

    it('deletes an existing approval rule', async () => {
        await saveToolApproval(workDir, {
            sessionId: 'sess-1',
            toolName: 'bash',
            args: { command: 'echo hello' },
            scope: 'session',
        });

        const listRes = await request(buildApp('alice').callback())
            .get('/api/tool-approvals');
        const ruleId = listRes.body.rules[0].id;

        const deleteRes = await request(buildApp('alice').callback())
            .delete(`/api/tool-approvals/${ruleId}`);

        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.ok).toBe(true);

        const afterRes = await request(buildApp('alice').callback())
            .get('/api/tool-approvals');
        expect(afterRes.body.rules).toHaveLength(0);
    });
});