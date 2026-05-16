import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { parseJsonOr } from '../utils/json.js';

export interface CronRunRecord {
    id: string;
    job_name: string;
    status: 'running' | 'success' | 'error';
    started_at: number;
    finished_at: number | null;
    duration_ms: number | null;
    error: string | null;
    summary: string | null;
}

const MAX_CRON_RUNS = 200;

function runsPath(stateDir: string): string {
    return join(stateDir, 'memory', 'cron-runs.json');
}

async function readRuns(stateDir: string): Promise<CronRunRecord[]> {
    try {
        const raw = await readFile(runsPath(stateDir), 'utf8');
        const parsed = parseJsonOr<unknown>(raw, []);
        return Array.isArray(parsed) ? parsed as CronRunRecord[] : [];
    } catch {
        return [];
    }
}

async function writeRuns(stateDir: string, runs: CronRunRecord[]): Promise<void> {
    await mkdir(join(stateDir, 'memory'), { recursive: true });
    const sorted = [...runs].sort((a, b) => b.started_at - a.started_at).slice(0, MAX_CRON_RUNS);
    await writeFile(runsPath(stateDir), JSON.stringify(sorted, null, 2), 'utf8');
}

export async function startCronRun(stateDir: string, jobName: string): Promise<CronRunRecord> {
    const run: CronRunRecord = {
        id: generateId(),
        job_name: jobName,
        status: 'running',
        started_at: Date.now(),
        finished_at: null,
        duration_ms: null,
        error: null,
        summary: null,
    };
    await writeRuns(stateDir, [run, ...await readRuns(stateDir)]);
    return run;
}

export async function finishCronRun(
    stateDir: string,
    runId: string,
    patch: { status: 'success' | 'error'; error?: string | null; summary?: string | null },
): Promise<CronRunRecord> {
    const runs = await readRuns(stateDir);
    const index = runs.findIndex((run) => run.id === runId);
    const now = Date.now();
    if (index < 0) {
        const fallback: CronRunRecord = {
            id: runId,
            job_name: 'unknown',
            status: patch.status,
            started_at: now,
            finished_at: now,
            duration_ms: 0,
            error: patch.error ?? null,
            summary: patch.summary ?? null,
        };
        await writeRuns(stateDir, [fallback, ...runs]);
        return fallback;
    }
    const existing = runs[index];
    const next: CronRunRecord = {
        ...existing,
        status: patch.status,
        finished_at: now,
        duration_ms: now - existing.started_at,
        error: patch.error ?? null,
        summary: patch.summary ?? null,
    };
    runs[index] = next;
    await writeRuns(stateDir, runs);
    return next;
}

export async function listCronRuns(stateDir: string, jobName?: string, limit = 20): Promise<CronRunRecord[]> {
    const runs = await readRuns(stateDir);
    return runs
        .filter((run) => !jobName || run.job_name === jobName)
        .sort((a, b) => b.started_at - a.started_at)
        .slice(0, Math.max(1, Math.min(limit, 100)));
}