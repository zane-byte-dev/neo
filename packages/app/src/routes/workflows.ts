import type Router from '@koa/router';
import { timingSafeEqual } from 'node:crypto';
import { calcUser, getWebhookSecret } from '@neo/agent/services/user-service.js';
import {
    deleteWorkflow,
    getWorkflow,
    listWorkflowRuns,
    listWorkflows,
    runWorkflow,
    runWorkflowById,
    saveWorkflow,
    workflowRunSummary,
} from '../services/workflow-service.js';

function safeEqual(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length, 1);
    const ab = Buffer.alloc(maxLen);
    const bb = Buffer.alloc(maxLen);
    Buffer.from(a, 'utf8').copy(ab);
    Buffer.from(b, 'utf8').copy(bb);
    return a.length === b.length && timingSafeEqual(ab, bb);
}

function readInput(body: Record<string, unknown>): unknown {
    return body.input !== undefined ? body.input : body;
}

export function workflowRoute(router: Router): void {
    router.get('/api/workflows', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        const workflows = await Promise.all((await listWorkflows(stateDir)).map(async (workflow) => {
            const [lastRun] = await listWorkflowRuns(stateDir, workflow.id, 1);
            return {
                ...workflow,
                lastRun: lastRun ? {
                    id: lastRun.id,
                    status: lastRun.status,
                    startedAt: lastRun.startedAt,
                    finishedAt: lastRun.finishedAt ?? null,
                    durationMs: lastRun.durationMs ?? null,
                    error: lastRun.error ?? null,
                    summary: workflowRunSummary(lastRun),
                } : null,
            };
        }));
        ctx.body = { workflows };
    });

    router.get('/api/workflows/:id', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        const workflow = await getWorkflow(stateDir, ctx.params.id ?? '');
        if (!workflow) {
            ctx.status = 404;
            ctx.body = { error: 'Workflow not found' };
            return;
        }
        ctx.body = { workflow, runs: await listWorkflowRuns(stateDir, workflow.id, 20) };
    });

    router.put('/api/workflows/:id', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        try {
            const workflow = await saveWorkflow(stateDir, ctx.params.id ?? '', ctx.request.body);
            ctx.body = { ok: true, workflow };
        } catch (err: unknown) {
            ctx.status = 400;
            ctx.body = { error: err instanceof Error ? err.message : 'Invalid workflow' };
        }
    });

    router.delete('/api/workflows/:id', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        if (!await deleteWorkflow(stateDir, ctx.params.id ?? '')) {
            ctx.status = 404;
            ctx.body = { error: 'Workflow not found' };
            return;
        }
        ctx.body = { ok: true };
    });

    router.post('/api/workflows/:id/run', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        try {
            const body = ctx.request.body as Record<string, unknown> | undefined;
            const run = await runWorkflowById(userId, stateDir, ctx.params.id ?? '', body?.input ?? {}, 'manual');
            ctx.body = { ok: run.status === 'success', run };
        } catch (err: unknown) {
            ctx.status = 404;
            ctx.body = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });

    router.get('/api/workflows/:id/runs', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        const limit = Number(ctx.query.limit ?? 20);
        ctx.body = { runs: await listWorkflowRuns(stateDir, ctx.params.id ?? '', Number.isFinite(limit) ? limit : 20) };
    });

    router.post('/api/workflow-webhook/:userId/:id', async (ctx) => {
        const userId = ctx.params.userId;
        const workflowId = ctx.params.id ?? '';
        const body = ctx.request.body as Record<string, unknown>;
        const secret = typeof body.secret === 'string' ? body.secret : '';
        try {
            const { stateDir } = await calcUser(userId);
            const workflow = await getWorkflow(stateDir, workflowId);
            if (!workflow) {
                ctx.status = 404;
                ctx.body = { error: 'Workflow not found' };
                return;
            }
            if (workflow.trigger.type !== 'webhook') {
                ctx.status = 400;
                ctx.body = { error: 'Workflow is not configured for webhook trigger' };
                return;
            }
            const expectedSecret = workflow.trigger.secret ?? getWebhookSecret(userId);
            if (!expectedSecret) {
                ctx.status = 404;
                ctx.body = { error: 'Webhook secret not configured' };
                return;
            }
            if (!secret || !safeEqual(secret, expectedSecret)) {
                ctx.status = 401;
                ctx.body = { error: 'Invalid webhook secret' };
                return;
            }
            const run = await runWorkflow(userId, workflow, readInput(body), 'webhook');
            ctx.body = { ok: run.status === 'success', run };
        } catch (err: unknown) {
            ctx.status = 500;
            ctx.body = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
}