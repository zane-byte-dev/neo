import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Koa from 'koa';
import Router from '@koa/router';
import request from 'supertest';
import { bodyParser } from '@koa/bodyparser';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockWorkDir, mockResumeRun } = vi.hoisted(() => ({
    mockWorkDir: { value: '' },
    mockResumeRun: vi.fn(),
}));

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

vi.mock('@neo/agent/services/agent-runner.js', () => ({
    resumeRun: mockResumeRun,
}));

import { toolConfirmRoute } from '../tool-confirm.js';
import { _resetPending, createConfirm } from '../../utils/pending-confirm.js';
import { createRun, loadRun, savePendingAction, loadPendingAction, listRunEvents, matchToolApprovalScope } from '@neo/runtime';

function buildApp(userId?: string): Koa {
    const app = new Koa();
    const router = new Router();
    app.use(async (ctx, next) => {
        if (userId) ctx.state.userId = userId;
        await next();
    });
    app.use(bodyParser());
    toolConfirmRoute(router);
    app.use(router.routes());
    app.use(router.allowedMethods());
    return app;
}

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-tool-confirm-'));
    mockWorkDir.value = workDir;
    mockResumeRun.mockResolvedValue('resumed');
    vi.clearAllMocks();
    _resetPending();
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('POST /api/tool-confirm — runtime-aware behaviour', () => {
    it('persists the decision and session approval rule when both runId+actionId are supplied for an in-memory waiter', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            sessionId: 'chat-session-1',
        });
        const { confirmId, promise } = createConfirm('alice', {
            runId: run.id,
            workDir,
            request: { toolName: 'bash', args: { command: 'rm -rf /tmp/x' } },
        });

        // Allow the persistence side-effect to flush before resolving.
        await new Promise((r) => setTimeout(r, 5));
        const before = await loadPendingAction(workDir, run.id);
        expect(before?.id).toBe(confirmId);
        expect(before?.status).toBe('pending');

        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: confirmId, approved: true, approvalScope: 'session' });

        expect(res.status).toBe(200);
        await expect(promise).resolves.toBe(true);
        // Allow the async pending-action update to flush.
        await new Promise((r) => setTimeout(r, 10));
        const after = await loadPendingAction(workDir, run.id);
        expect(after?.status).toBe('approved');
        expect(await matchToolApprovalScope(workDir, {
            sessionId: 'chat-session-1',
            toolName: 'bash',
            args: { command: 'rm -rf /tmp/x' },
        })).toBe('session');

        // confirm_resolved event written.
        const events = await listRunEvents(workDir, run.id);
        const resolved = events.find((e) => e.type === 'confirm_resolved');
        expect(resolved).toBeTruthy();
        expect(resolved?.type === 'confirm_resolved' ? resolved.payload.approvalScope : undefined).toBe('session');
    });

    it('legacy {confirmId} payload still works without runId', async () => {
        const { confirmId, promise } = createConfirm('alice');
        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ confirmId, approved: false });
        expect(res.status).toBe(200);
        await expect(promise).resolves.toBe(false);
    });

    it('falls back to disk-backed resolution when no live waiter is present', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'waiting_confirm',
        });
        const action = await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: { toolName: 'bash' },
        });

        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: action.id, approved: true });
        expect(res.status).toBe(200);
        expect(res.body.persisted).toBe(true);
        expect(res.body.resumeScheduled).toBe(true);
        expect(mockResumeRun).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice', runId: run.id }));
        const after = await loadPendingAction(workDir, run.id);
        expect(after?.status).toBe('approved');
    });

    it('marks the run cancelled when a disk-backed action is denied after restart', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'waiting_confirm',
        });
        const action = await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: { toolName: 'bash', args: { command: 'rm -rf /tmp/demo' } },
        });

        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: action.id, approved: false });

        expect(res.status).toBe(200);
        expect(res.body.persisted).toBe(true);
        expect(res.body.resumeScheduled).toBe(false);
        expect(mockResumeRun).not.toHaveBeenCalled();

        const pending = await loadPendingAction(workDir, run.id);
        expect(pending?.status).toBe('denied');

        const afterRun = await loadRun(workDir, run.id);
        expect(afterRun?.status).toBe('cancelled');

        const events = await listRunEvents(workDir, run.id);
        expect(events.find((e) => e.type === 'confirm_resolved')).toBeTruthy();
    });

    it('returns 409 when the disk-backed action is already resolved', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const action = await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: {},
        });
        // Resolve once.
        await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: action.id, approved: true });

        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: action.id, approved: false });
        expect(res.status).toBe(409);
    });

    it('returns 404 when actionId does not match the persisted pending action', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: {},
        });
        const res = await request(buildApp('alice').callback())
            .post('/api/tool-confirm')
            .send({ runId: run.id, actionId: 'wrong', approved: true });
        expect(res.status).toBe(404);
    });
});
