/**
 * tool-confirm.ts — POST /api/tool-confirm
 *
 * Client-side UI calls this to approve/deny a dangerous tool invocation
 * that was paused on the SSE stream.
 *
 * Two payload shapes are accepted:
 *   - Legacy: `{ confirmId, approved }` — opaque id minted by
 *     `createConfirm` and surfaced to the client on the SSE
 *     `tool_confirm` chunk.
 *   - Runtime: `{ runId, actionId, approved }` — preferred shape going
 *     forward; routes through the runtime `pending_action` store and
 *     emits a `confirm_resolved` event.
 *
 * Because `confirmId` is intentionally identical to `actionId` (see
 * `utils/pending-confirm.ts`), both shapes ultimately resolve the same
 * pending entry. The legacy shape stays supported indefinitely so the
 * web client can be upgraded independently.
 */
import type Router from '@koa/router';
import { resolveConfirm, lookupConfirmOwner } from '../utils/pending-confirm.js';
import { calcUser } from '../services/user-service.js';
import { resolvePendingAction, loadPendingAction } from '../runtime/pending-actions.js';
import { appendRunEventSafe, updateRunStatusSafe } from '../runtime/executor.js';

export function toolConfirmRoute(router: Router): void {
    router.post('/api/tool-confirm', async (ctx) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'unauthorized' };
            return;
        }
        const body = ctx.request.body as Record<string, unknown>;
        const confirmId = typeof body.confirmId === 'string' ? body.confirmId : '';
        const runId = typeof body.runId === 'string' ? body.runId : '';
        const actionId = typeof body.actionId === 'string' ? body.actionId : '';
        const approved = body.approved === true;
        const effectiveId = confirmId || actionId;
        if (!effectiveId) {
            ctx.status = 400;
            ctx.body = { error: 'confirmId required' };
            return;
        }

        // Resolve via the in-memory registry first (covers all running
        // executors). When a legacy confirmId is supplied the owner is
        // implicit; when only `runId/actionId` were supplied we still
        // need to authorise against the in-memory entry's userId.
        if (lookupConfirmOwner(effectiveId)) {
            const ok = resolveConfirm(effectiveId, userId, approved);
            if (!ok) {
                ctx.status = 404;
                ctx.body = { error: 'unknown or expired confirmId' };
                return;
            }
            ctx.body = { ok: true };
            return;
        }

        // No live waiter. If `runId` is supplied, fall through to the
        // disk-backed store so a process restart can still record a
        // decision (run will be picked up by the sweeper or resume
        // logic later).
        if (runId) {
            try {
                const userCtx = await calcUser(userId);
                const pending = await loadPendingAction(userCtx.workDir, runId);
                if (!pending || pending.id !== effectiveId) {
                    ctx.status = 404;
                    ctx.body = { error: 'unknown or expired confirmId' };
                    return;
                }
                if (pending.status !== 'pending') {
                    ctx.status = 409;
                    ctx.body = { error: 'already resolved', status: pending.status };
                    return;
                }
                const status = approved ? 'approved' : 'denied';
                await resolvePendingAction(userCtx.workDir, {
                    runId,
                    actionId: effectiveId,
                    status,
                    resolution: { decidedBy: 'user' },
                });
                await appendRunEventSafe(userCtx.workDir, runId, 'confirm_resolved', {
                    actionId: effectiveId,
                    status,
                    decidedBy: 'user',
                });
                // No live executor; mark the run as cancelled (denied)
                // or leave it in waiting_confirm for the resume path.
                if (!approved) {
                    await updateRunStatusSafe(userCtx.workDir, runId, 'cancelled');
                }
                ctx.body = { ok: true, persisted: true };
                return;
            } catch {
                ctx.status = 500;
                ctx.body = { error: 'failed to persist decision' };
                return;
            }
        }

        ctx.status = 404;
        ctx.body = { error: 'unknown or expired confirmId' };
    });
}
