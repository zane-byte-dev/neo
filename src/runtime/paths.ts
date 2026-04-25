/**
 * src/runtime/paths.ts — Centralised path helpers for runtime artefacts.
 *
 * The runtime persists each run under {workDir}/.neo/runs/{runId}/ as
 * defined by docs/AGENT_RUNTIME_PLAN.md §3.1. This module is the single
 * source of truth for that layout so other runtime modules (store,
 * events, checkpoint, pending) do not hand-roll join() calls.
 */

import { join, resolve } from 'node:path';
import { RUNTIME_LAYOUT } from './types.js';

/** Return the absolute path to {workDir}/.neo/runs/. */
export function runsRoot(workDir: string): string {
    return resolve(workDir, RUNTIME_LAYOUT.runsDir);
}

/** Return the absolute path to {workDir}/.neo/runs/{runId}/. */
export function runDir(workDir: string, runId: string): string {
    return join(runsRoot(workDir), runId);
}

export function runFilePath(workDir: string, runId: string): string {
    return join(runDir(workDir, runId), RUNTIME_LAYOUT.runFile);
}

export function eventsFilePath(workDir: string, runId: string): string {
    return join(runDir(workDir, runId), RUNTIME_LAYOUT.eventsFile);
}

export function checkpointFilePath(workDir: string, runId: string): string {
    return join(runDir(workDir, runId), RUNTIME_LAYOUT.checkpointFile);
}

export function pendingFilePath(workDir: string, runId: string): string {
    return join(runDir(workDir, runId), RUNTIME_LAYOUT.pendingFile);
}

export function artifactsDir(workDir: string, runId: string): string {
    return join(runDir(workDir, runId), RUNTIME_LAYOUT.artifactsDir);
}
