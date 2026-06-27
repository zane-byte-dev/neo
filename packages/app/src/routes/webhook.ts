/**
 * webhook.ts — Programmatic endpoint for external systems to trigger the agent.
 *
 * POST /api/webhook/:userId
 * Body: { message: string, sessionId?: string, secret: string }
 *
 * Authenticates via a per-user webhook secret defined in the USERS env var
 * (users[].webhookSecret). Triggers an agent turn asynchronously and returns
 * the result when complete.
 */
import type Router from '@koa/router';
import { neoAgentRuntime } from '../app/agent-runtime.js';
import { generateId } from '@neo/agent/utils/id-generator.js';
import { log } from '@neo/agent/utils/logger.js';
import { MAX_INPUT_LENGTH } from '@neo/agent/config.js';
import { calcUser, getWebhookSecret } from '@neo/agent/services/user-service.js';
import { timingSafeEqual } from 'node:crypto';
import { newRunId, persistImageArtifact, pruneTextChunkEventsSafe, readRunOutcome } from '@neo/runtime';

const MODULE = 'Webhook';

function safeEqual(a: string, b: string): boolean {
    // Pad to same length to prevent timing side-channel leaking secret length
    const maxLen = Math.max(a.length, b.length, 1);
    const ab = Buffer.alloc(maxLen);
    const bb = Buffer.alloc(maxLen);
    Buffer.from(a, 'utf8').copy(ab);
    Buffer.from(b, 'utf8').copy(bb);
    return a.length === b.length && timingSafeEqual(ab, bb);
}

export function webhookRoute(router: Router): void {
    router.post('/api/webhook/:userId', async (ctx) => {
        const userId = ctx.params.userId;
        const body = ctx.request.body as Record<string, unknown>;
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const secret = typeof body.secret === 'string' ? body.secret : '';
        const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
            ? body.sessionId.trim()
            : `webhook-${generateId()}`;

        // Validate webhook secret
        const expectedSecret = getWebhookSecret(userId);
        if (!expectedSecret) {
            ctx.status = 404;
            ctx.body = { error: 'User not found or webhook not configured' };
            return;
        }

        if (!secret || !safeEqual(secret, expectedSecret)) {
            ctx.status = 401;
            ctx.body = { error: 'Invalid webhook secret' };
            return;
        }

        if (!message) {
            ctx.status = 400;
            ctx.body = { error: 'message is required' };
            return;
        }

        if (message.length > MAX_INPUT_LENGTH) {
            ctx.status = 400;
            ctx.body = { error: `message too long (max ${MAX_INPUT_LENGTH} chars)` };
            return;
        }

        log.info(MODULE, 'Webhook received', { userId, sessionId, messageLen: message.length });

        try {
            const userCtx = await calcUser(userId);
            const stateDir = userCtx.stateDir ?? userCtx.workDir;
            const runId = newRunId();
            const result = await neoAgentRuntime.startRun({
                userId,
                sessionId,
                runId,
                message,
                entrypoint: 'webhook',
                triggerType: 'webhook_call',
                onImage: async (data, mimeType, caption) => {
                    return persistImageArtifact(stateDir, runId, data, mimeType, caption);
                },
                onVideo: async (url) => ({ url }),
            });
            const output = result.output;
            if (stateDir && runId) await pruneTextChunkEventsSafe(stateDir, runId);
            const outcome = runId
                ? await readRunOutcome(stateDir, runId, { fallbackText: output })
                : null;

            ctx.body = {
                ok: true,
                sessionId,
                ...(runId ? { runId } : {}),
                response: outcome?.responseText ?? output,
                artifacts: outcome?.artifacts ?? [],
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(MODULE, 'Webhook turn failed', { userId, sessionId, error: msg });
            ctx.status = 500;
            ctx.body = { ok: false, error: msg };
        }
    });
}
