/**
 * src/runtime/pending-actions.ts — Persistent pending-action storage.
 *
 * Layout: {stateDir}/runs/{runId}/pending.json
 *
 * Replaces the in-memory `pending-confirm` registry's persistence
 * concern. A run may have at most one outstanding pending action at a
 * time (per `docs/features/agent-runtime/plan.md` §3.1) — when a new one is
 * created, it overwrites the previous file.
 *
 * Resolution writes the same file with `status` flipped to one of
 * `approved` / `denied` / `cancelled` / `expired` and a `resolution`
 * payload. Callers should also append a `confirm_resolved` event via
 * `appendEvent()` so the run's history reflects the decision.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { pendingFilePath } from './paths.js';
import type {
    JsonObject,
    PendingAction,
    PendingActionStatus,
    PendingActionType,
} from './types.js';

export interface CreatePendingActionInput {
    /** Optional explicit id; generated when omitted. */
    id?: string;
    runId: string;
    type: PendingActionType;
    request: JsonObject;
    requestedBy?: 'system' | 'user';
    /** Wall-clock expiry; pair with {@link expirePendingAction}. */
    expiresAt?: string;
}

/**
 * Persist a fresh pending action with status `pending`. Overwrites any
 * existing pending file (callers are expected to {@link resolvePendingAction}
 * the previous one first when that matters).
 */
export async function savePendingAction(
    workDir: string,
    input: CreatePendingActionInput,
): Promise<PendingAction> {
    const now = new Date().toISOString();
    const action: PendingAction = {
        id: input.id ?? `action_${generateId()}`,
        runId: input.runId,
        type: input.type,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
        ...(input.requestedBy !== undefined && { requestedBy: input.requestedBy }),
        request: input.request,
    };
    await _writePending(workDir, action);
    return action;
}

/** Load the current pending action for a run, or `null` when absent. */
export async function loadPendingAction(
    workDir: string,
    runId: string,
): Promise<PendingAction | null> {
    const path = pendingFilePath(workDir, runId);
    if (!existsSync(path)) return null;
    try {
        const buf = await readFile(path, 'utf8');
        return JSON.parse(buf) as PendingAction;
    } catch {
        return null;
    }
}

export interface ResolvePendingActionInput {
    runId: string;
    actionId: string;
    /** New terminal status: `approved` / `denied` / `submitted` / `cancelled` / `expired`. */
    status: Exclude<PendingActionStatus, 'pending'>;
    resolution?: JsonObject;
}

/**
 * Resolve the run's pending action.
 *
 * Returns the updated record on success, or `null` when no matching
 * pending action exists (unknown runId, mismatched actionId, or already
 * resolved with a different id).
 */
export async function resolvePendingAction(
    workDir: string,
    input: ResolvePendingActionInput,
): Promise<PendingAction | null> {
    const current = await loadPendingAction(workDir, input.runId);
    if (!current) return null;
    if (current.id !== input.actionId) return null;
    if (current.status !== 'pending') return null;
    const next: PendingAction = {
        ...current,
        status: input.status,
        updatedAt: new Date().toISOString(),
        ...(input.resolution !== undefined && { resolution: input.resolution }),
    };
    await _writePending(workDir, next);
    return next;
}

/**
 * Mark a pending action as `expired` if it is still pending and its
 * `expiresAt` is in the past relative to `now`. Returns the updated
 * record, or `null` if no action expired.
 */
export async function expirePendingAction(
    workDir: string,
    runId: string,
    now: Date = new Date(),
): Promise<PendingAction | null> {
    const current = await loadPendingAction(workDir, runId);
    if (!current || current.status !== 'pending') return null;
    if (!current.expiresAt) return null;
    if (Date.parse(current.expiresAt) > now.getTime()) return null;
    return resolvePendingAction(workDir, {
        runId,
        actionId: current.id,
        status: 'expired',
        resolution: { reason: 'timeout' },
    });
}

/**
 * Remove the pending file. Mainly used by tests; production code should
 * resolve actions instead so the audit trail stays intact.
 */
export async function clearPendingAction(workDir: string, runId: string): Promise<void> {
    const path = pendingFilePath(workDir, runId);
    if (!existsSync(path)) return;
    await unlink(path);
}

async function _writePending(workDir: string, action: PendingAction): Promise<void> {
    const path = pendingFilePath(workDir, action.runId);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(action, null, 2), 'utf8');
    await rename(tmp, path);
}
