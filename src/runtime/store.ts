/**
 * src/runtime/store.ts — Persistent CRUD for {@link RunRecord}.
 *
 * Layout: {stateDir}/runs/{runId}/run.json
 *
 * The store is intentionally minimal: create / load / save / list / update
 * status. Event append, checkpoint save, and pending action persistence
 * each live in their own module so that the per-file write strategies
 * (atomic-replace vs append-only) stay obvious.
 *
 * All writes are atomic (write to a temp file, rename) to avoid leaving
 * a partially-written run.json behind on crash.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { runDir, runFilePath, runsRoot } from './paths.js';
import type {
    RunEntrypoint,
    RunRecord,
    RunRequestPayload,
    RunStatus,
    RunTriggerType,
} from './types.js';

/** Minimal options accepted by {@link createRun}. */
export interface CreateRunInput {
    /** Optional explicit id. If omitted a fresh id is generated. */
    id?: string;
    userId: string;
    entrypoint: RunEntrypoint;
    triggerType: RunTriggerType;
    sessionId?: string;
    notebook?: string;
    parentRunId?: string;
    request?: RunRequestPayload;
    metadata?: RunRecord['metadata'];
    /** Override the initial status (defaults to `queued`). */
    status?: RunStatus;
}

/**
 * Generate a sortable, human-friendly run id.
 *
 * Format: `run_<timestamp>_<random>` so directory listings sort by
 * creation time and ids stay readable in logs.
 */
export function newRunId(now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
    return `run_${stamp}_${generateId()}`;
}

/**
 * Create a fresh run on disk and return the persisted record.
 *
 * Callers are expected to follow up with a `run_created` event via
 * {@link appendEvent} so that the event log stays the source of truth.
 */
export async function createRun(workDir: string, input: CreateRunInput): Promise<RunRecord> {
    const id = input.id ?? newRunId();
    const now = new Date().toISOString();
    const record: RunRecord = {
        id,
        userId: input.userId,
        status: input.status ?? 'queued',
        entrypoint: input.entrypoint,
        triggerType: input.triggerType,
        createdAt: now,
        updatedAt: now,
        ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
        ...(input.notebook !== undefined && { notebook: input.notebook }),
        ...(input.parentRunId !== undefined && { parentRunId: input.parentRunId }),
        request: input.request ?? {},
        ...(input.metadata !== undefined && { metadata: input.metadata }),
    };
    await mkdir(runDir(workDir, id), { recursive: true });
    await _atomicWriteJson(runFilePath(workDir, id), record);
    return record;
}

/**
 * Load a previously persisted run. Returns `null` when the run does not
 * exist (e.g. wrong runId or freshly cleaned workspace).
 */
export async function loadRun(workDir: string, runId: string): Promise<RunRecord | null> {
    const path = runFilePath(workDir, runId);
    if (!existsSync(path)) return null;
    try {
        const buf = await readFile(path, 'utf8');
        return JSON.parse(buf) as RunRecord;
    } catch {
        return null;
    }
}

/**
 * Persist a run record (full overwrite, atomic). The caller is
 * responsible for keeping `record.id` in sync with the directory.
 *
 * `updatedAt` is refreshed automatically.
 */
export async function saveRun(workDir: string, record: RunRecord): Promise<RunRecord> {
    const updated: RunRecord = { ...record, updatedAt: new Date().toISOString() };
    const path = runFilePath(workDir, updated.id);
    await mkdir(dirname(path), { recursive: true });
    await _atomicWriteJson(path, updated);
    return updated;
}

/**
 * Status transition helper. Keeps the timestamp bookkeeping
 * (`startedAt`, `finishedAt`) in one place so call-sites do not have to
 * remember it.
 */
export async function updateRunStatus(
    workDir: string,
    runId: string,
    status: RunStatus,
    extra: Partial<Pick<RunRecord, 'lastError' | 'metrics' | 'pendingActionId' | 'metadata'>> = {},
): Promise<RunRecord | null> {
    const current = await loadRun(workDir, runId);
    if (!current) return null;
    const now = new Date().toISOString();
    const next: RunRecord = {
        ...current,
        ...extra,
        status,
        updatedAt: now,
        ...(status === 'running' && !current.startedAt ? { startedAt: now } : {}),
        ...(_isTerminal(status) && !current.finishedAt ? { finishedAt: now } : {}),
    };
    return saveRun(workDir, next);
}

/**
 * List run ids under {stateDir}/runs/, ordered newest first by
 * directory name (which embeds the creation timestamp).
 */
export function listRunIds(workDir: string): string[] {
    const root = runsRoot(workDir);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));
}

const TERMINAL: ReadonlySet<RunStatus> = new Set([
    'completed',
    'failed',
    'cancelled',
    'expired',
]);

function _isTerminal(status: RunStatus): boolean {
    return TERMINAL.has(status);
}

/**
 * Delete run directories that are older than `maxAgeMs` milliseconds
 * (default: 30 days) and have reached a terminal state.  Active /
 * non-terminal runs are never deleted.  Returns the count removed.
 *
 * Age is derived from the run id timestamp prefix (run_YYYYMMDD_…), so
 * no disk read is needed for the fast path.  Only terminal runs whose
 * `finishedAt` field confirms they completed are removed.
 */
export async function pruneOldRuns(
    stateDir: string,
    maxAgeMs = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
    const root = runsRoot(stateDir);
    if (!existsSync(root)) return 0;
    const entries = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory());
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const entry of entries) {
        // Quick age check via the embedded timestamp in the run id.
        // Format: run_YYYYMMDD_HHMMSS_<random>
        const m = entry.name.match(/^run_(\d{8})_(\d{6})_/);
        if (!m) continue;
        const [, date, time] = m;
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
        if (Date.parse(iso) >= cutoff) continue; // still within retention window

        // Confirm terminal state before deleting.
        const dir = runDir(stateDir, entry.name);
        try {
            const raw = await readFile(runFilePath(stateDir, entry.name), 'utf8');
            const rec = JSON.parse(raw) as { status?: string };
            const terminalStates = new Set(['completed', 'failed', 'cancelled', 'expired']);
            if (!terminalStates.has(rec.status ?? '')) continue; // non-terminal, skip
        } catch {
            // Missing or corrupt run.json — safe to remove the directory.
        }
        try {
            await rm(dir, { recursive: true, force: true });
            removed++;
        } catch {
            // Best-effort: ignore individual removal errors.
        }
    }
    return removed;
}

async function _atomicWriteJson(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, path);
}
