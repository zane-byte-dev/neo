/**
 * src/crons/index.ts — Auto-discovery registry for cron jobs with DB persistence.
 *
 * To add a new cron job, create src/crons/my-job.ts and export a `CronJob` object.
 * It will be picked up automatically — no manual registration needed.
 *
 * Code-defined jobs are synced to the `cron_jobs` table at startup.
 * The DB `enabled` flag overrides the code default.
 * Every execution is recorded in the `cron_runs` table.
 */
import cron from 'node-cron';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoLoad } from '../utils/auto-loader.js';
import { getDb } from '../services/db.js';
import type { CronJob, CronDeps } from './_base.js';

export type { CronJob, CronDeps } from './_base.js';

/** Map of job name → { job, deps } for manual triggering from the web API */
const jobRegistry = new Map<string, { job: CronJob; deps: CronDeps }>();

export function getRegisteredJob(name: string) {
    return jobRegistry.get(name);
}

export function getAllRegisteredJobs() {
    return [...jobRegistry.values()].map(({ job }) => job);
}

/** Sync a code-defined job to the DB; code is source of truth for name/schedule/description. */
function syncJobToDb(job: CronJob): { enabled: boolean; schedule: string } {
    const db = getDb();
    const now = Date.now();
    const existing = db.prepare('SELECT enabled, schedule FROM cron_jobs WHERE name = ?').get(job.name) as
        | { enabled: number; schedule: string }
        | undefined;

    if (!existing) {
        db.prepare(
            'INSERT INTO cron_jobs (name, schedule, description, enabled, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run(job.name, job.schedule, job.description ?? null, job.enabled === false ? 0 : 1, now);
        return { enabled: job.enabled !== false, schedule: job.schedule };
    }

    // Update description from code; keep DB enabled & schedule as overrides
    db.prepare('UPDATE cron_jobs SET description = ?, updated_at = ? WHERE name = ?').run(
        job.description ?? null,
        now,
        job.name,
    );
    return { enabled: existing.enabled === 1, schedule: existing.schedule };
}

/** Record a run start; returns the run ID. */
function recordRunStart(jobName: string): number {
    const db = getDb();
    const info = db
        .prepare('INSERT INTO cron_runs (job_name, status, started_at) VALUES (?, ?, ?)')
        .run(jobName, 'running', Date.now());
    return Number(info.lastInsertRowid);
}

/** Finalize a run with success or error. */
function recordRunEnd(runId: number, status: 'success' | 'error', summary?: string, error?: string) {
    const db = getDb();
    const now = Date.now();
    const started = (
        db.prepare('SELECT started_at FROM cron_runs WHERE id = ?').get(runId) as { started_at: number } | undefined
    )?.started_at;
    const durationMs = started ? now - started : null;
    db.prepare(
        'UPDATE cron_runs SET status = ?, finished_at = ?, duration_ms = ?, summary = ?, error = ? WHERE id = ?',
    ).run(status, now, durationMs, summary ?? null, error ?? null, runId);
}

export async function executeJob(jobName: string): Promise<{ status: string; summary?: string; error?: string }> {
    const entry = jobRegistry.get(jobName);
    if (!entry) return { status: 'error', error: `Job "${jobName}" not found` };

    const runId = recordRunStart(jobName);
    try {
        const summary = await entry.job.handler(entry.deps);
        recordRunEnd(runId, 'success', typeof summary === 'string' ? summary : undefined);
        return { status: 'success', summary: typeof summary === 'string' ? summary : undefined };
    } catch (err: any) {
        const msg = err.message || String(err);
        recordRunEnd(runId, 'error', undefined, msg);
        return { status: 'error', error: msg };
    }
}

