/**
 * File-backed RuntimeStore adapter.
 *
 * This wraps the existing file-oriented runtime functions behind a single
 * dependency shape so the app can later swap in package or database backed
 * stores without changing AgentRuntime consumers.
 */

import { deleteCheckpoint, loadCheckpoint, saveCheckpoint } from './checkpoint.js';
import { appendEvent, lastEventIndex, listRunEvents, pruneTextChunkEvents } from './events.js';
import { clearPendingAction, expirePendingAction, loadPendingAction, resolvePendingAction, savePendingAction } from './pending-actions.js';
import { deleteToolApproval, listToolApprovals, matchToolApprovalScope, saveToolApproval } from './tool-approvals.js';
import { createRun, listRunIds, loadRun, saveRun, updateRunStatus } from './store.js';
import type { EventCursorOptions, RuntimeStore } from './contracts.js';
import type { RunCheckpoint, RunEvent, RunEventType, RunRecord, RunStatus } from './types.js';
import type { AppendEventOptions } from './events.js';
import type { CreatePendingActionInput, ResolvePendingActionInput } from './pending-actions.js';
import type { CreateRunInput } from './store.js';
import type { MatchApprovalInput, SaveApprovalInput, ToolApprovalRule } from './tool-approvals.js';

const appendRunEventUntyped = appendEvent as (
    stateDir: string,
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
    opts?: AppendEventOptions,
) => Promise<RunEvent>;

export class FileRuntimeStore implements RuntimeStore {
    createRun(stateDir: string, input: CreateRunInput): Promise<RunRecord> {
        return createRun(stateDir, input);
    }

    listRunIds(stateDir: string): string[] {
        return listRunIds(stateDir);
    }

    loadRun(stateDir: string, runId: string): Promise<RunRecord | null> {
        return loadRun(stateDir, runId);
    }

    saveRun(stateDir: string, run: RunRecord): Promise<RunRecord> {
        return saveRun(stateDir, run);
    }

    updateRunStatus(
        stateDir: string,
        runId: string,
        status: RunStatus,
        extra: Parameters<typeof updateRunStatus>[3] = {},
    ): Promise<RunRecord | null> {
        return updateRunStatus(stateDir, runId, status, extra);
    }

    appendRunEvent(
        stateDir: string,
        runId: string,
        type: RunEventType,
        payload: RunEvent['payload'],
        opts: AppendEventOptions = {},
    ): Promise<RunEvent> {
        return appendRunEventUntyped(stateDir, runId, type, payload, opts);
    }

    listRunEvents(stateDir: string, runId: string, opts: EventCursorOptions = {}): Promise<RunEvent[]> {
        return listRunEvents(stateDir, runId, opts);
    }

    lastRunEventIndex(stateDir: string, runId: string): Promise<number> {
        return lastEventIndex(stateDir, runId);
    }

    pruneRunTextChunkEvents(stateDir: string, runId: string): Promise<void> {
        return pruneTextChunkEvents(stateDir, runId);
    }

    loadCheckpoint(stateDir: string, runId: string): Promise<RunCheckpoint | null> {
        return loadCheckpoint(stateDir, runId);
    }

    saveCheckpoint(stateDir: string, checkpoint: RunCheckpoint): Promise<RunCheckpoint> {
        return saveCheckpoint(stateDir, checkpoint);
    }

    deleteCheckpoint(stateDir: string, runId: string): Promise<void> {
        return deleteCheckpoint(stateDir, runId);
    }

    savePendingAction(stateDir: string, input: CreatePendingActionInput) {
        return savePendingAction(stateDir, input);
    }

    loadPendingAction(stateDir: string, runId: string) {
        return loadPendingAction(stateDir, runId);
    }

    resolvePendingAction(stateDir: string, input: ResolvePendingActionInput) {
        return resolvePendingAction(stateDir, input);
    }

    expirePendingAction(stateDir: string, runId: string, now: Date = new Date()) {
        return expirePendingAction(stateDir, runId, now);
    }

    clearPendingAction(stateDir: string, runId: string): Promise<void> {
        return clearPendingAction(stateDir, runId);
    }

    matchToolApprovalScope(stateDir: string, input: MatchApprovalInput) {
        return matchToolApprovalScope(stateDir, input);
    }

    saveToolApproval(stateDir: string, input: SaveApprovalInput) {
        return saveToolApproval(stateDir, input);
    }

    listToolApprovals(stateDir: string): Promise<ToolApprovalRule[]> {
        return listToolApprovals(stateDir);
    }

    deleteToolApproval(stateDir: string, ruleId: string): Promise<boolean> {
        return deleteToolApproval(stateDir, ruleId);
    }
}

export const fileRuntimeStore = new FileRuntimeStore();
