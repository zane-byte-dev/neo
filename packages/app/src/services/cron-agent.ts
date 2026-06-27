/**
 * cron-agent.ts — Scheduled task runner for proactive agent behavior.
 *
 * Reads scheduled tasks from {stateDir}/memory/schedule.json for each user
 * and triggers agent turns at configured intervals using node-cron.
 *
 * Schedule file format (memory/schedule.json):
 * [
 *   {
 *     "id": "morning-brief",
 *     "cron": "0 8 * * *",
 *     "message": "给我今天的天气和日程摘要",
 *     "enabled": true
 *   }
 * ]
 */
import { schedule as cronSchedule, validate as cronValidate, type ScheduledTask as CronTask } from 'node-cron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { neoAgentRuntime } from '../app/agent-runtime.js';
import { newRunId, persistImageArtifact, pruneTextChunkEventsSafe, readRunOutcome, renderArtifactReferences } from '@neo/runtime';
import { generateId } from '@neo/agent/utils/id-generator.js';
import { parseJsonOr } from '@neo/agent/utils/json.js';
import { log } from '@neo/agent/utils/logger.js';
import { userList } from '@neo/agent/services/user-service.js';
import { finishCronRun, startCronRun, type CronRunRecord } from './cron-history.js';
import { listWorkflows, runWorkflow, workflowRunSummary, type WorkflowDefinition } from './workflow-service.js';

const MODULE = 'CronAgent';

interface ScheduledTask {
    id: string;
    cron: string;
    message: string;
    enabled?: boolean;
    /** IANA timezone (default: user's or 'Asia/Shanghai') */
    timezone?: string;
}

function readAllUserIds(): string[] {
    return userList().map(u => u.id);
}

function stateDirForUser(userId: string): string | undefined {
    const user = userList().find((u) => u.id === userId);
    return user?.stateDir ?? undefined;
}

async function readSchedule(userId: string): Promise<ScheduledTask[]> {
    const stateDir = stateDirForUser(userId);
    if (!stateDir) return [];
    const schedulePath = join(stateDir, 'memory', 'schedule.json');
    try {
        const raw = await fs.readFile(schedulePath, 'utf8');
        const tasks = parseJsonOr<unknown>(raw, []);
        if (!Array.isArray(tasks)) return [];
        return tasks as ScheduledTask[];
    } catch {
        return [];
    }
}

/** Active cron jobs, keyed by `${userId}:${taskId}` */
const activeJobs = new Map<string, CronTask>();

function summarizeText(text: string): string {
    const trimmed = text.trim();
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

export async function runScheduledTask(userId: string, task: ScheduledTask): Promise<CronRunRecord | null> {
    const sessionId = `cron-${task.id}-${generateId()}`;
    const stateDir = stateDirForUser(userId);
    const history = stateDir ? await startCronRun(stateDir, task.id) : null;
    log.info(MODULE, 'Executing scheduled task', { userId, taskId: task.id, sessionId });

    try {
        const runId = newRunId();
        const result = await neoAgentRuntime.startRun({
            userId,
            sessionId,
            runId,
            message: task.message,
            entrypoint: 'cron',
            triggerType: 'scheduled_task',
            metadata: { taskId: task.id, cron: task.cron },
            onImage: stateDir
                ? async (data, mimeType, caption) => persistImageArtifact(stateDir, runId, data, mimeType, caption)
                : undefined,
            onVideo: async (url) => ({ url }),
        });
        const output = result.output;
        if (stateDir && runId) await pruneTextChunkEventsSafe(stateDir, runId);
        const outcome = stateDir && runId
            ? await readRunOutcome(stateDir, runId, { fallbackText: output })
            : null;
        const artifactRefs = renderArtifactReferences(outcome?.artifacts ?? []);

        const responseText = outcome?.responseText ?? output;
        log.info(MODULE, 'Scheduled task completed', {
            userId,
            taskId: task.id,
            responseLen: responseText.length,
            artifactCount: outcome?.artifacts.length ?? 0,
        });
        return stateDir && history
            ? finishCronRun(stateDir, history.id, { status: 'success', summary: summarizeText(responseText) })
            : null;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(MODULE, 'Scheduled task failed', { userId, taskId: task.id, error: msg });
        return stateDir && history
            ? finishCronRun(stateDir, history.id, { status: 'error', error: msg })
            : null;
    }
}

async function runCronWorkflow(userId: string, workflow: WorkflowDefinition): Promise<void> {
    log.info(MODULE, 'Executing workflow schedule', { userId, workflowId: workflow.id });
    const run = await runWorkflow(userId, workflow, { trigger: 'cron', workflowId: workflow.id }, 'cron');
    if (run.status === 'error') {
        log.error(MODULE, 'Workflow schedule failed', { userId, workflowId: workflow.id, error: run.error });
    } else {
        log.info(MODULE, 'Workflow schedule completed', { userId, workflowId: workflow.id, runId: run.id });
    }
}

/**
 * Start the cron agent. Reads schedule files for all users and sets up
 * node-cron jobs.
 */
export async function startCronAgent(): Promise<void> {
    const userIds = readAllUserIds();

    for (const userId of userIds) {
        const tasks = await readSchedule(userId);
        const enabledTasks = tasks.filter(t => t.enabled !== false);

        for (const task of enabledTasks) {
            if (!cronValidate(task.cron)) {
                log.warn(MODULE, `Invalid cron expression for ${userId}:${task.id}: ${task.cron}`);
                continue;
            }

            const jobKey = `${userId}:${task.id}`;

            // Stop existing job if re-loading
            if (activeJobs.has(jobKey)) {
                activeJobs.get(jobKey)!.stop();
            }

            const job = cronSchedule(task.cron, async () => {
                await runScheduledTask(userId, task);
            }, {
                timezone: task.timezone ?? 'Asia/Shanghai',
            });

            activeJobs.set(jobKey, job);
            log.info(MODULE, `Scheduled: ${jobKey} (${task.cron})`, { message: task.message.slice(0, 60) });
        }

        const stateDir = stateDirForUser(userId);
        const workflows = stateDir ? await listWorkflows(stateDir) : [];
        for (const workflow of workflows) {
            if (!workflow.enabled || workflow.trigger.type !== 'cron' || workflow.trigger.enabled === false) continue;
            if (!cronValidate(workflow.trigger.cron)) {
                log.warn(MODULE, `Invalid workflow cron expression for ${userId}:${workflow.id}: ${workflow.trigger.cron}`);
                continue;
            }
            const jobKey = `${userId}:workflow:${workflow.id}`;
            const job = cronSchedule(workflow.trigger.cron, async () => {
                await runCronWorkflow(userId, workflow);
            }, {
                timezone: workflow.trigger.timezone ?? 'Asia/Shanghai',
            });
            activeJobs.set(jobKey, job);
            log.info(MODULE, `Scheduled workflow: ${jobKey} (${workflow.trigger.cron})`);
        }
    }

    if (activeJobs.size > 0) {
        log.info(MODULE, `Started with ${activeJobs.size} scheduled tasks`);
    } else {
        log.info(MODULE, 'No scheduled tasks found');
    }

}

/**
 * Reload schedules for a specific user or all users.
 */
export async function reloadSchedules(): Promise<number> {
    let count = 0;

    // startCronAgent reads schedules for all users, so clear all existing jobs
    // first to avoid duplicate user/system schedules after any reload.
    for (const [, job] of activeJobs) {
        job.stop();
    }
    activeJobs.clear();

    // Re-start the cron agent (it will re-read all schedules)
    await startCronAgent();
    count = activeJobs.size;
    return count;
}

/** Stop all scheduled jobs. */
export function stopCronAgent(): void {
    for (const [, job] of activeJobs) {
        job.stop();
    }
    activeJobs.clear();
    log.info(MODULE, 'All scheduled tasks stopped');
}
