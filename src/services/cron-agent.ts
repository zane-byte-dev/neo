/**
 * cron-agent.ts — Scheduled task runner for proactive agent behavior.
 *
 * Reads scheduled tasks from {workDir}/memory/schedule.json for each user
 * and triggers agent turns at configured intervals using node-cron.
 *
 * Schedule file format (memory/schedule.json):
 * [
 *   {
 *     "id": "morning-brief",
 *     "cron": "0 8 * * *",
 *     "message": "给我今天的天气和日程摘要",
 *     "enabled": true,
 *     "telegramChatId": "8094416266"
 *   }
 * ]
 */
import cron from 'node-cron';
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runAgentTurn } from '../services/agent-runner.js';
import { generateId } from '../utils/id-generator.js';
import { log } from '../utils/logger.js';
import type { TelegramRuntime } from '../platforms/telegram-bot.js';

const MODULE = 'CronAgent';

const _projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const _spaceDir = resolve(_projectRoot, 'space');

interface ScheduledTask {
    id: string;
    cron: string;
    message: string;
    enabled?: boolean;
    /** If set, send result to this Telegram chat */
    telegramChatId?: string;
}

interface ConfigUser {
    id: string;
}

function readAllUserIds(): string[] {
    try {
        const raw = readFileSync(join(_spaceDir, 'config.json'), 'utf8');
        const data = JSON.parse(raw) as { users?: ConfigUser[] };
        return (data.users ?? []).map(u => u.id);
    } catch {
        return [];
    }
}

async function readSchedule(userId: string): Promise<ScheduledTask[]> {
    const schedulePath = join(_spaceDir, userId, 'memory', 'schedule.json');
    try {
        const raw = await fs.readFile(schedulePath, 'utf8');
        const tasks = JSON.parse(raw);
        if (!Array.isArray(tasks)) return [];
        return tasks;
    } catch {
        return [];
    }
}

/** Active cron jobs, keyed by `${userId}:${taskId}` */
const activeJobs = new Map<string, cron.ScheduledTask>();

/**
 * Start the cron agent. Reads schedule files for all users and sets up
 * node-cron jobs. Optionally accepts a Telegram runtime for sending
 * results to Telegram chats/channels.
 */
export async function startCronAgent(telegram?: TelegramRuntime | null): Promise<void> {
    const userIds = readAllUserIds();

    for (const userId of userIds) {
        const tasks = await readSchedule(userId);
        const enabledTasks = tasks.filter(t => t.enabled !== false);

        for (const task of enabledTasks) {
            if (!cron.validate(task.cron)) {
                log.warn(MODULE, `Invalid cron expression for ${userId}:${task.id}: ${task.cron}`);
                continue;
            }

            const jobKey = `${userId}:${task.id}`;

            // Stop existing job if re-loading
            if (activeJobs.has(jobKey)) {
                activeJobs.get(jobKey)!.stop();
            }

            const job = cron.schedule(task.cron, async () => {
                const sessionId = `cron-${task.id}-${generateId()}`;
                log.info(MODULE, 'Executing scheduled task', { userId, taskId: task.id, sessionId });

                try {
                    const output = await runAgentTurn({
                        userId,
                        sessionId,
                        message: task.message,
                    });

                    // Send to Telegram if configured
                    if (task.telegramChatId && telegram) {
                        const text = output || '（定时任务无输出）';
                        const prefix = `🕐 [定时任务: ${task.id}]\n\n`;
                        try {
                            await telegram.sendMessage(task.telegramChatId, prefix + text);
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : String(err);
                            log.error(MODULE, 'Failed to send Telegram message', { userId, taskId: task.id, error: msg });
                        }
                    }

                    log.info(MODULE, 'Scheduled task completed', { userId, taskId: task.id, responseLen: output.length });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    log.error(MODULE, 'Scheduled task failed', { userId, taskId: task.id, error: msg });
                }
            }, {
                timezone: 'Asia/Shanghai',
            });

            activeJobs.set(jobKey, job);
            log.info(MODULE, `Scheduled: ${jobKey} (${task.cron})`, { message: task.message.slice(0, 60) });
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
export async function reloadSchedules(telegram?: TelegramRuntime | null, userId?: string): Promise<number> {
    const userIds = userId ? [userId] : readAllUserIds();
    let count = 0;

    // Stop existing jobs for the target users
    for (const uid of userIds) {
        for (const [key, job] of activeJobs) {
            if (key.startsWith(`${uid}:`)) {
                job.stop();
                activeJobs.delete(key);
            }
        }
    }

    // Re-start the cron agent (it will re-read all schedules)
    await startCronAgent(telegram);
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
