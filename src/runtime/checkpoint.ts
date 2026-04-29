/**
 * src/runtime/checkpoint.ts — Resumable execution snapshots.
 *
 * Layout: {stateDir}/runs/{runId}/checkpoint.json
 *
 * Checkpoints capture just enough state for `resumeRun()` to pick up a
 * partially-completed turn — partial response, history cursor, current
 * tool step. Full event history lives in events.jsonl; checkpoints are
 * written as small atomic-replace JSON files and may be overwritten
 * freely.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkpointFilePath } from './paths.js';
import type { RunCheckpoint } from './types.js';

/**
 * Persist a checkpoint, refreshing `updatedAt`. Atomic-replace so a
 * crash mid-write never leaves a corrupt file behind.
 */
export async function saveCheckpoint(
    workDir: string,
    checkpoint: RunCheckpoint,
): Promise<RunCheckpoint> {
    const updated: RunCheckpoint = { ...checkpoint, updatedAt: new Date().toISOString() };
    const path = checkpointFilePath(workDir, updated.runId);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
    await rename(tmp, path);
    return updated;
}

/** Load the latest checkpoint, or `null` when none has been written. */
export async function loadCheckpoint(
    workDir: string,
    runId: string,
): Promise<RunCheckpoint | null> {
    const path = checkpointFilePath(workDir, runId);
    if (!existsSync(path)) return null;
    try {
        const buf = await readFile(path, 'utf8');
        return JSON.parse(buf) as RunCheckpoint;
    } catch {
        return null;
    }
}
