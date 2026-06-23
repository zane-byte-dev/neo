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
import { neoAgentRuntime } from '../app/agent-runtime.js';
import { appendRunEventSafe, loadPendingAction, loadRun, resolvePendingAction, saveToolApproval, updateRunStatusSafe, type JsonObject, type ToolApprovalScope } from '@neo/runtime';
import { log } from '../utils/logger.js';

async function persistApprovalRule(
    stateDir: string,
    runId: string,
    actionId: string,
    approvalScope: ToolApprovalScope,
): Promise<ToolApprovalScope | undefined> {
    if (approvalScope === 'once') return 'once';
    const pending = await loadPendingAction(stateDir, runId);
    if (!pending || pending.id !== actionId) return 'once';
    const toolName = typeof pending.request.toolName === 'string' ? pending.request.toolName : '';
    const args = pending.request.args && typeof pending.request.args === 'object' && !Array.isArray(pending.request.args)
        ? pending.request.args as Record<string, unknown>
        : {};
    if (!toolName) return 'once';

    if (approvalScope === 'session') {
        const run = await loadRun(stateDir, runId);
        if (!run?.sessionId) return 'once';
        await saveToolApproval(stateDir, {
            sessionId: run.sessionId,
            toolName,
            args,
            scope: 'session',
        });
        return 'session';
    }

    await saveToolApproval(stateDir, {
        toolName,
        args,
        scope: 'always',
    });
    return 'always';
}

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
        const approvalScope: ToolApprovalScope = body.approvalScope === 'session'
            ? 'session'
            : body.approvalScope === 'always'
                ? 'always'
                : 'once';
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
            let effectiveScope: ToolApprovalScope | undefined;
            if (approved && runId) {
                try {
                    const userCtx = await calcUser(userId);
                    const stateDir = userCtx.stateDir ?? userCtx.workDir;
                    effectiveScope = await persistApprovalRule(stateDir, runId, effectiveId, approvalScope);
                } catch (error: unknown) {
                    log.warn('ToolConfirmRoute', 'failed to persist approval rule for live waiter', {
                        runId,
                        actionId: effectiveId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            const ok = resolveConfirm(effectiveId, userId, approved, {
                ...(approved ? { approvalScope: effectiveScope ?? approvalScope } : {}),
            });
            if (!ok) {
                ctx.status = 404;
                ctx.body = { error: 'unknown or expired confirmId' };
                return;
            }
            ctx.body = { ok: true, ...(approved ? { approvalScope: effectiveScope ?? approvalScope } : {}) };
            return;
        }

        // No live waiter. If `runId` is supplied, fall through to the
        // disk-backed store so a process restart can still record a
        // decision (run will be picked up by the sweeper or resume
        // logic later).
        if (runId) {
            try {
                const userCtx = await calcUser(userId);
                const stateDir = userCtx.stateDir ?? userCtx.workDir;
                const pending = await loadPendingAction(stateDir, runId);
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
                const effectiveScope = approved
                    ? await persistApprovalRule(stateDir, runId, effectiveId, approvalScope)
                    : undefined;
                const status = approved ? 'approved' : 'denied';
                await resolvePendingAction(stateDir, {
                    runId,
                    actionId: effectiveId,
                    status,
                    resolution: {
                        decidedBy: 'user',
                        ...(approved && effectiveScope ? { approvalScope: effectiveScope } : {}),
                    } as JsonObject,
                });
                await appendRunEventSafe(stateDir, runId, 'confirm_resolved', {
                    actionId: effectiveId,
                    status,
                    decidedBy: 'user',
                    ...(approved && effectiveScope ? { approvalScope: effectiveScope } : {}),
                });
                if (approved) {
                    void neoAgentRuntime.resumeRun({ userId, runId }).catch((error) => {
                        log.warn('ToolConfirmRoute', 'failed to resume disk-backed run after approval', {
                            runId,
                            actionId: effectiveId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                } else {
                    await updateRunStatusSafe(stateDir, runId, 'cancelled');
                }
                ctx.body = {
                    ok: true,
                    persisted: true,
                    resumeScheduled: approved,
                    ...(approved && effectiveScope ? { approvalScope: effectiveScope } : {}),
                };
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
