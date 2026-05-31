/**
 * src/runtime/sweeper.ts — Startup recovery / timeout pass.
 *
 * The runtime is recoverable: every state transition is on disk. But
 * the in-memory pieces (LLM streaming, abort signals, the JS Promise
 * holding `confirmCallback`) are not. After a process restart, runs
 * that were `running` or `waiting_*` need to be moved into a terminal
 * state so the audit trail is honest and so a future resume path can
 * pick them up.
 *
 * The sweeper performs three passes per user workspace:
 *
 *   1. Expire any `pending_action` whose `expiresAt` is past.
 *   2. Mark `waiting_confirm` runs whose pending action was just expired
 *      as `expired`.
 *   3. Mark orphaned `running` / `queued` runs (no live executor in
 *      this process) as `failed` with reason `process_restart`.
 *
 * Returns a per-user count summary so the caller (server startup) can
 * log it.
 */

import { listRunIds, loadRun, updateRunStatus } from './store.js';
import { expirePendingAction, loadPendingAction } from './pending-actions.js';
import { appendEvent } from './events.js';
import { log } from '../utils/logger.js';
import type { RunStatus } from './types.js';

const MODULE = 'RuntimeSweeper';

export interface SweepResult {
    userId: string;
    expiredPendingActions: number;
    expiredRuns: number;
    orphanedRuns: number;
}

/**
 * Sweep the runs directory for a single user workspace. Safe to call
 * concurrently for different workspaces — callers serialise per-user.
 */
export async function sweepUserWorkspace(
    workDir: string,
    userId: string,
    now: Date = new Date(),
): Promise<SweepResult> {
    const result: SweepResult = {
        userId,
        expiredPendingActions: 0,
        expiredRuns: 0,
        orphanedRuns: 0,
    };

    const ids = listRunIds(workDir);
    for (const runId of ids) {
        const run = await loadRun(workDir, runId);
        if (!run) continue;
        // Defensive: ignore runs that do not belong to this user.
        if (run.userId !== userId) continue;

        // 1) Pending action timeout.
        const pending = await loadPendingAction(workDir, runId);
        if (pending && pending.status === 'pending') {
            const expired = await expirePendingAction(workDir, runId, now);
            if (expired) {
                result.expiredPendingActions += 1;
                await _safeAppend(workDir, runId, 'confirm_resolved', {
                    actionId: expired.id,
                    status: 'expired',
                    decidedBy: 'system',
                    reason: 'timeout_at_sweep',
                });
            }
        }

        // 2) Promote waiting_* with no in-flight executor to a terminal
        //    state. Because the live executor would have refreshed
        //    `updatedAt` very recently, we use a 5-minute idle threshold.
        const idleMs = now.getTime() - Date.parse(run.updatedAt);
        const STALE_MS = 5 * 60 * 1000;
        if (run.status === 'waiting_confirm' || run.status === 'waiting_input') {
            if (idleMs > STALE_MS) {
                await updateRunStatus(workDir, runId, 'expired', {
                    lastError: { message: 'sweeper: idle waiting state' },
                });
                await _safeAppend(workDir, runId, 'run_failed', {
                    finishedAt: now.toISOString(),
                    error: { message: 'sweeper: idle waiting state' },
                });
                result.expiredRuns += 1;
            }
            continue;
        }

        // 3) Orphan running / queued runs older than the threshold.
        if (run.status === 'running' || run.status === 'queued') {
            if (idleMs > STALE_MS) {
                await updateRunStatus(workDir, runId, 'failed', {
                    lastError: { message: 'sweeper: process_restart' },
                });
                await _safeAppend(workDir, runId, 'run_failed', {
                    finishedAt: now.toISOString(),
                    error: { message: 'sweeper: process_restart' },
                });
                result.orphanedRuns += 1;
            }
        }
    }

    return result;
}

/**
 * Sweep every known user workspace. Pulls the list lazily from
 * `userList()` so the sweeper does not hard-code the user-service
 * import shape — keeps tests easy to set up.
 */
export async function sweepAllUserWorkspaces(
    users: Iterable<{ userId: string; workDir: string }>,
    now: Date = new Date(),
): Promise<SweepResult[]> {
    const results: SweepResult[] = [];
    for (const { userId, workDir } of users) {
        try {
            const result = await sweepUserWorkspace(workDir, userId, now);
            results.push(result);
            if (
                result.expiredPendingActions ||
                result.expiredRuns ||
                result.orphanedRuns
            ) {
                log.info(MODULE, 'Swept workspace', { ...result });
            }
        } catch (err: unknown) {
            log.warn(MODULE, 'sweep failed', {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return results;
}

async function _safeAppend(
    workDir: string,
    runId: string,
    type: 'run_failed' | 'confirm_resolved',
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (appendEvent as any)(workDir, runId, type, payload);
    } catch {
        /* best-effort */
    }
}
