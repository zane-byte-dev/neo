/**
 * src/runtime/executor.ts — Event-driven agent execution helpers.
 *
 * The runtime executor is the seam between {@link runAgentTurn} and the
 * persistence layer in `src/runtime/`. It exposes thin helpers that
 * agent-runner can use to:
 *
 *   - emit lifecycle events (`appendRunEventSafe`)
 *   - update the run's status / metrics (`updateRunStatusSafe`,
 *     `bumpRunMetrics`)
 *   - flush a checkpoint (`saveRunCheckpointSafe`)
 *
 * Every helper swallows persistence errors and logs them at WARN level
 * so that an unwritable workspace never breaks an in-flight LLM turn.
 * Run state is best-effort, the actual conversation is the source of
 * truth for the user.
 */

import { type AppendEventOptions } from './events.js';
import { fileRuntimeStore } from './file-store.js';
import type { RuntimeStore } from './contracts.js';
import type {
    JsonObject,
    RunCheckpoint,
    RunEvent,
    RunEventType,
    RunMetrics,
    RunRecord,
    RunStatus,
} from './types.js';
import { log } from './internal/logger.js';

const MODULE = 'RuntimeExecutor';

type PayloadOf<T extends RunEventType> = Extract<RunEvent, { type: T }>['payload'];
type RunStatusExtra = Partial<Pick<RunRecord, 'lastError' | 'metrics' | 'pendingActionId' | 'metadata'>>;

/**
 * Append a runtime event without ever throwing into the caller.
 *
 * Returns the event id when the write succeeded, `null` otherwise.
 * Useful for callers that want to log an audit trail but cannot afford
 * to fail the user-facing turn just because a disk write failed.
 */
export async function appendRunEventSafe<T extends RunEventType>(
    workDir: string,
    runId: string,
    type: T,
    payload: PayloadOf<T>,
    opts?: AppendEventOptions,
    store: RuntimeStore = fileRuntimeStore,
): Promise<string | null> {
    try {
        const event = await store.appendRunEvent(workDir, runId, type, payload, opts);
        return event.id;
    } catch (err: unknown) {
        log.warn(MODULE, 'appendEvent failed', {
            runId,
            type,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/** Same as {@link updateRunStatus} but logs+swallows persistence errors. */
export async function updateRunStatusSafe(
    workDir: string,
    runId: string,
    status: RunStatus,
    extra?: RunStatusExtra,
    store: RuntimeStore = fileRuntimeStore,
): Promise<RunRecord | null> {
    try {
        return await store.updateRunStatus(workDir, runId, status, extra);
    } catch (err: unknown) {
        log.warn(MODULE, 'updateRunStatus failed', {
            runId,
            status,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/** Same as {@link saveCheckpoint} but never propagates persistence errors. */
export async function saveRunCheckpointSafe(
    workDir: string,
    checkpoint: RunCheckpoint,
    store: RuntimeStore = fileRuntimeStore,
): Promise<RunCheckpoint | null> {
    try {
        return await store.saveCheckpoint(workDir, checkpoint);
    } catch (err: unknown) {
        log.warn(MODULE, 'saveCheckpoint failed', {
            runId: checkpoint.runId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * Delete the run's checkpoint once it has reached a terminal state.
 * Swallows all errors — cleanup is best-effort.
 */
export async function deleteRunCheckpointSafe(
    workDir: string,
    runId: string,
    store: RuntimeStore = fileRuntimeStore,
): Promise<void> {
    try {
        await store.deleteCheckpoint(workDir, runId);
    } catch (err: unknown) {
        log.warn(MODULE, 'deleteCheckpoint failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Rewrite the run's event log, stripping text/thought llm_chunk events
 * that are only needed during live streaming.  Called after a run
 * reaches a terminal state; errors are logged and swallowed.
 */
export async function pruneTextChunkEventsSafe(
    workDir: string,
    runId: string,
    store: RuntimeStore = fileRuntimeStore,
): Promise<void> {
    try {
        await store.pruneRunTextChunkEvents(workDir, runId);
    } catch (err: unknown) {
        log.warn(MODULE, 'pruneTextChunkEvents failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Atomically merge a metrics delta into the run's existing metrics
 * record (numeric fields are summed; defined string/object fields are
 * shallow-copied as overrides).
 */
export async function bumpRunMetrics(
    workDir: string,
    runId: string,
    delta: Partial<RunMetrics>,
    store: RuntimeStore = fileRuntimeStore,
): Promise<void> {
    try {
        const current = await store.loadRun(workDir, runId);
        if (!current) return;
        const merged: RunMetrics = { ...(current.metrics ?? {}) };
        for (const [k, v] of Object.entries(delta)) {
            if (v === undefined) continue;
            const key = k as keyof RunMetrics;
            const prev = merged[key];
            if (typeof v === 'number' && typeof prev === 'number') {
                (merged as Record<string, unknown>)[key] = prev + v;
            } else if (typeof v === 'number' && prev === undefined) {
                (merged as Record<string, unknown>)[key] = v;
            } else {
                (merged as Record<string, unknown>)[key] = v;
            }
        }
        await store.saveRun(workDir, { ...current, metrics: merged });
    } catch (err: unknown) {
        log.warn(MODULE, 'bumpRunMetrics failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Best-effort short preview of a string for logs / event payloads.
 *
 * Trims whitespace, collapses to a head-and-tail snippet so consumers
 * never receive megabyte-sized previews even if a tool returns a huge
 * blob. The return value is always ≤ `maxLen` characters.
 */
export function previewText(text: string | undefined, maxLen = 200): string | undefined {
    if (text === undefined) return undefined;
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (trimmed.length <= maxLen) return trimmed;
    const head = trimmed.slice(0, Math.max(0, Math.floor(maxLen / 2) - 5));
    const tail = trimmed.slice(-Math.max(0, Math.floor(maxLen / 2) - 5));
    return `${head}…${tail}`;
}

export interface CancellationProbe {
    /** Returns true once a cancel-run signal has been recorded. */
    isCancelled(): boolean;
    /** Stop the background poll. Idempotent. Always call from a finally block. */
    dispose(): void;
}

/**
 * Watch a run record for an external cancellation signal. The runs API
 * (`POST /api/runs/:id/cancel`) bumps `metadata.cancelRequested` to
 * `true`; the executor calls this probe between major steps to honour
 * it without coupling the API to the executor.
 *
 * Always pair with `dispose()` (e.g. in a `finally` block) so the
 * background poll does not outlive the turn.
 */
export function startCancellationProbe(
    workDir: string,
    runId: string,
    store: RuntimeStore = fileRuntimeStore,
): CancellationProbe {
    let cancelled = false;
    let stopped = false;
    const tick = async (): Promise<void> => {
        if (stopped || cancelled) return;
        try {
            const cur = await store.loadRun(workDir, runId);
            const meta = cur?.metadata as JsonObject | undefined;
            if (meta?.cancelRequested === true) cancelled = true;
        } catch { /* ignore */ }
    };
    // First poll immediately so callers do not have to wait for the timer.
    void tick();
    const handle = setInterval(() => { void tick(); }, 1_000);
    // Allow Node.js to exit even if a probe is pending.
    if (typeof handle.unref === 'function') handle.unref();
    const dispose = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(handle);
    };
    return {
        isCancelled() {
            // Stop probe once the caller observed cancellation.
            if (cancelled) dispose();
            return cancelled;
        },
        dispose,
    };
}
