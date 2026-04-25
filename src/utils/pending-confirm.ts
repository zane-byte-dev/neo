/**
 * pending-confirm.ts — Bridge between awaiting tool confirmations and
 * the runtime `pending_action` store.
 *
 * Two roles:
 *   1. Hold the in-process `resolve()` callback so the SSE chat handler
 *      can `await` the user's decision.
 *   2. Persist the same request as a runtime `pending_action` so that
 *      a process restart can still surface the request and record an
 *      audit trail (`confirm_requested` / `confirm_resolved` events).
 *
 * `confirmId` is intentionally identical to the persisted `actionId`
 * so the legacy `POST /api/tool-confirm { confirmId }` API keeps
 * working untouched while new clients can also use
 * `{ runId, actionId }`.
 */

import { generateId } from './id-generator.js';
import { log } from './logger.js';
import {
    resolvePendingAction,
    savePendingAction,
} from '../runtime/pending-actions.js';
import {
    appendRunEventSafe,
    updateRunStatusSafe,
} from '../runtime/executor.js';

const MODULE = 'PendingConfirm';

interface Pending {
    userId: string;
    resolve: (approved: boolean) => void;
    timer: NodeJS.Timeout;
    /** Optional persistent context — when set, decisions are mirrored to disk. */
    runId?: string;
    workDir?: string;
}

const _pending = new Map<string, Pending>();

/** Default wait time before auto-deny. */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

export interface CreateConfirmOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    /** When provided, the confirmation is also persisted as a runtime pending_action. */
    runId?: string;
    /** Required alongside `runId` to know where to write. */
    workDir?: string;
    /** Tool details to capture in the persistent record. */
    request?: { toolName?: string; args?: Record<string, unknown> };
}

export interface CreateConfirmResult {
    confirmId: string;
    /** Resolves with the user's decision, or `false` on timeout/abort. */
    promise: Promise<boolean>;
}

export function createConfirm(
    userId: string,
    opts: CreateConfirmOptions = {},
): CreateConfirmResult {
    const confirmId = generateId();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    let settle!: (approved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { settle = resolve; });

    const timer = setTimeout(() => {
        const entry = _pending.get(confirmId);
        if (!_pending.delete(confirmId)) return;
        // Mirror timeout to disk + audit trail.
        if (entry?.runId && entry.workDir) {
            void resolvePendingAction(entry.workDir, {
                runId: entry.runId,
                actionId: confirmId,
                status: 'expired',
                resolution: { reason: 'timeout' },
            }).then(() => appendRunEventSafe(
                entry.workDir!,
                entry.runId!,
                'confirm_resolved',
                { actionId: confirmId, status: 'expired', decidedBy: 'system', reason: 'timeout' },
            )).then(() => updateRunStatusSafe(entry.workDir!, entry.runId!, 'running'));
        }
        settle(false);
    }, timeoutMs);

    _pending.set(confirmId, {
        userId,
        ...(opts.runId !== undefined && { runId: opts.runId }),
        ...(opts.workDir !== undefined && { workDir: opts.workDir }),
        resolve: (approved) => {
            clearTimeout(timer);
            settle(approved);
        },
        timer,
    });

    if (opts.signal) {
        const onAbort = () => {
            const entry = _pending.get(confirmId);
            if (entry) {
                _pending.delete(confirmId);
                if (entry.runId && entry.workDir) {
                    void resolvePendingAction(entry.workDir, {
                        runId: entry.runId,
                        actionId: confirmId,
                        status: 'cancelled',
                        resolution: { reason: 'abort' },
                    }).then(() => appendRunEventSafe(
                        entry.workDir!,
                        entry.runId!,
                        'confirm_resolved',
                        { actionId: confirmId, status: 'cancelled', decidedBy: 'system', reason: 'abort' },
                    ));
                }
                entry.resolve(false);
            }
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Persist the pending action when caller provided run context.
    if (opts.runId && opts.workDir) {
        const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
        const argsJson = opts.request?.args as unknown as import('../runtime/types.js').JsonObject | undefined;
        const requestPayload: import('../runtime/types.js').JsonObject = {};
        if (opts.request?.toolName !== undefined) requestPayload.toolName = opts.request.toolName;
        if (argsJson !== undefined) requestPayload.args = argsJson;
        void savePendingAction(opts.workDir, {
            id: confirmId,
            runId: opts.runId,
            type: 'tool_confirmation',
            request: requestPayload,
            requestedBy: 'system',
            expiresAt,
        }).then(() => appendRunEventSafe(
            opts.workDir!,
            opts.runId!,
            'confirm_requested',
            {
                actionId: confirmId,
                actionType: 'tool_confirmation',
                ...(opts.request?.toolName !== undefined && { toolName: opts.request.toolName }),
                ...(argsJson !== undefined && { args: argsJson }),
                expiresAt,
            },
        )).then(() => updateRunStatusSafe(
            opts.workDir!,
            opts.runId!,
            'waiting_confirm',
            { pendingActionId: confirmId },
        )).catch((err: unknown) => {
            log.warn(MODULE, 'persist pending action failed', {
                runId: opts.runId,
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }

    return { confirmId, promise };
}

/**
 * Resolve a pending confirmation. Returns true when a matching pending entry
 * was found and the caller owned it. Returns false on mismatch (unknown id,
 * wrong user, already resolved).
 */
export function resolveConfirm(
    confirmId: string,
    userId: string,
    approved: boolean,
): boolean {
    const entry = _pending.get(confirmId);
    if (!entry) return false;
    if (entry.userId !== userId) return false;
    _pending.delete(confirmId);
    if (entry.runId && entry.workDir) {
        const status = approved ? 'approved' : 'denied';
        void resolvePendingAction(entry.workDir, {
            runId: entry.runId,
            actionId: confirmId,
            status,
            resolution: { decidedBy: 'user' },
        }).then(() => appendRunEventSafe(
            entry.workDir!,
            entry.runId!,
            'confirm_resolved',
            { actionId: confirmId, status, decidedBy: 'user' },
        )).then(() => updateRunStatusSafe(entry.workDir!, entry.runId!, 'running'));
    }
    entry.resolve(approved);
    return true;
}

/**
 * Look up the userId that originated a still-in-memory confirmation.
 * Used by the runtime-aware tool-confirm route to authorise decisions
 * keyed by `runId/actionId` without leaking ownership.
 */
export function lookupConfirmOwner(confirmId: string): string | null {
    return _pending.get(confirmId)?.userId ?? null;
}

/** Test helper. */
export function _resetPending(): void {
    for (const [, entry] of _pending) clearTimeout(entry.timer);
    _pending.clear();
}
