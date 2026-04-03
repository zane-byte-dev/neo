/**
 * _base.ts — Shared types for cron job modules.
 */
import type { TenantKey } from '../types/platform.js';

export interface CronDeps {
    /** All tenant keys this cron should operate on */
    tenantKeys: TenantKey[];
    sendReply: (tenantKey: TenantKey, text: string) => Promise<void>;
}

export interface CronJob {
    /** Unique name for logging */
    name: string;
    /** Cron expression (node-cron format) */
    schedule: string;
    /** The task to execute */
    handler: (deps: CronDeps) => Promise<void>;
    /** Set to false to disable without removing the file */
    enabled?: boolean;
}
