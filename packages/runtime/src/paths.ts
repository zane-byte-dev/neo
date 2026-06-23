/**
 * src/runtime/paths.ts — Centralised path helpers for runtime artefacts.
 *
 * The runtime persists each run under {stateDir}/runs/{runId}/ as
 * defined by docs/developer-guide/AGENT_RUNTIME_PLAN.md §3.1. This module is the single
 * source of truth for that layout so other runtime modules (store,
 * events, checkpoint, pending) do not hand-roll join() calls.
 */

import { join, resolve } from 'node:path';
import { RUNTIME_LAYOUT } from './types.js';

/** Return the absolute path to {stateDir}/runs/. */
export function runsRoot(stateDir: string): string {
    return resolve(stateDir, RUNTIME_LAYOUT.runsDir);
}

/** Return the absolute path to {stateDir}/runs/{runId}/. */
export function runDir(stateDir: string, runId: string): string {
    return join(runsRoot(stateDir), runId);
}

export function runFilePath(stateDir: string, runId: string): string {
    return join(runDir(stateDir, runId), RUNTIME_LAYOUT.runFile);
}

export function eventsFilePath(stateDir: string, runId: string): string {
    return join(runDir(stateDir, runId), RUNTIME_LAYOUT.eventsFile);
}

export function checkpointFilePath(stateDir: string, runId: string): string {
    return join(runDir(stateDir, runId), RUNTIME_LAYOUT.checkpointFile);
}

export function pendingFilePath(stateDir: string, runId: string): string {
    return join(runDir(stateDir, runId), RUNTIME_LAYOUT.pendingFile);
}

export function artifactsDir(stateDir: string, runId: string): string {
    return join(runDir(stateDir, runId), RUNTIME_LAYOUT.artifactsDir);
}
