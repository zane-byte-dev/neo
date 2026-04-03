/**
 * src/crons/index.ts — Auto-discovery registry for cron jobs.
 *
 * To add a new cron job, create src/crons/my-job.ts and export a `CronJob` object.
 * It will be picked up automatically — no manual registration needed.
 */
import cron from 'node-cron';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoLoad } from '../utils/auto-loader.js';
import type { CronJob, CronDeps } from './_base.js';

export type { CronJob, CronDeps } from './_base.js';

function isCronJob(value: unknown): value is CronJob {
    return (
        typeof value === 'object' &&
        value !== null &&
        'name' in value &&
        'schedule' in value &&
        'handler' in value &&
        typeof (value as CronJob).name === 'string' &&
        typeof (value as CronJob).schedule === 'string' &&
        typeof (value as CronJob).handler === 'function'
    );
}

export async function setupCronJobs(deps: CronDeps): Promise<void> {
    const dir = dirname(fileURLToPath(import.meta.url));
    const jobs = await autoLoad(dir, isCronJob);

    let count = 0;
    for (const job of jobs) {
        if (job.enabled === false) continue;

        cron.schedule(job.schedule, async () => {
            console.log(`[Cron] Execution starting: ${job.name}`);
            try {
                await job.handler(deps);
            } catch (error: any) {
                console.error(`[Cron Error ${job.name}] ${error}`);
                // Send error to all tenants
                for (const tk of deps.tenantKeys) {
                    await deps.sendReply(tk, `❌ **${job.name} 失败**:\n${error.message || error.stderr}`);
                }
            }
        });

        console.log(`[Cron] ✅ ${job.name} (${job.schedule})`);
        count++;
    }

    console.log(`[Cron] ${count} cron jobs configured`);
}
