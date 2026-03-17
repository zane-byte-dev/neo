/**
 * _base.ts — Shared types for cron job modules.
 */

export interface CronDeps {
    chatId: number;
    sendReply: (chatId: number, text: string) => Promise<void>;
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
