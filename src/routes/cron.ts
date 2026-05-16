import type Router from '@koa/router';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validate as cronValidate } from 'node-cron';
import { calcUser } from '../services/user-service.js';
import { reloadSchedules, runScheduledTask } from '../services/cron-agent.js';
import { listCronRuns } from '../services/cron-history.js';
import { parseJsonOr } from '../utils/json.js';

interface ScheduledTask {
    id: string;
    cron: string;
    message: string;
    enabled?: boolean;
    timezone?: string;
    telegramChatId?: string;
}

const TASK_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

function schedulePath(stateDir: string): string {
    return join(stateDir, 'memory', 'schedule.json');
}

async function readSchedule(stateDir: string): Promise<ScheduledTask[]> {
    try {
        const raw = await readFile(schedulePath(stateDir), 'utf8');
        const parsed = parseJsonOr<unknown>(raw, []);
        return Array.isArray(parsed) ? parsed as ScheduledTask[] : [];
    } catch {
        return [];
    }
}

async function writeSchedule(stateDir: string, tasks: ScheduledTask[]): Promise<void> {
    await mkdir(join(stateDir, 'memory'), { recursive: true });
    await writeFile(schedulePath(stateDir), JSON.stringify(tasks, null, 2), 'utf8');
}

function normalizeTask(id: string, body: Record<string, unknown>, existing?: ScheduledTask): ScheduledTask | null {
    const cron = typeof body.cron === 'string'
        ? body.cron.trim()
        : typeof body.schedule === 'string'
            ? body.schedule.trim()
            : existing?.cron ?? '';
    const message = typeof body.message === 'string' ? body.message : existing?.message ?? '';
    if (!cronValidate(cron) || !message.trim()) return null;
    const timezone = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : existing?.timezone;
    const telegramChatId = typeof body.telegramChatId === 'string' && body.telegramChatId.trim()
        ? body.telegramChatId.trim()
        : existing?.telegramChatId;
    return {
        id,
        cron,
        message,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : existing?.enabled ?? true,
        ...(timezone ? { timezone } : {}),
        ...(telegramChatId ? { telegramChatId } : {}),
    };
}

export function cronRoute(router: Router): void {
    router.get('/api/crons', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir } = await calcUser(userId);
        ctx.body = await Promise.all((await readSchedule(stateDir)).map(async (task) => {
            const [lastRun] = await listCronRuns(stateDir, task.id, 1);
            return {
                name: task.id,
                schedule: task.cron,
                description: task.message,
                enabled: task.enabled === false ? 0 : 1,
                updated_at: lastRun?.finished_at ?? lastRun?.started_at ?? 0,
                last_status: lastRun?.status ?? null,
                last_started_at: lastRun?.started_at ?? null,
                last_finished_at: lastRun?.finished_at ?? null,
                last_duration_ms: lastRun?.duration_ms ?? null,
                last_error: lastRun?.error ?? null,
                last_summary: lastRun?.summary ?? null,
            };
        }));
    });

    router.get('/api/crons/:name/runs', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const limit = Number(ctx.query.limit ?? 20);
        const { stateDir } = await calcUser(userId);
        ctx.body = await listCronRuns(stateDir, name, Number.isFinite(limit) ? limit : 20);
    });

    router.post('/api/crons/:name/run', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const { stateDir } = await calcUser(userId);
        const task = (await readSchedule(stateDir)).find((item) => item.id === name);
        if (!task) {
            ctx.status = 404;
            ctx.body = { error: 'Task not found' };
            return;
        }
        const run = await runScheduledTask(userId, task);
        if (!run) {
            ctx.status = 500;
            ctx.body = { status: 'error', error: 'Cron run history unavailable' };
            return;
        }
        ctx.body = { status: run.status, summary: run.summary ?? undefined, error: run.error ?? undefined, run };
    });

    router.put('/api/crons/:name', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        if (!TASK_NAME_PATTERN.test(name)) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid task name' };
            return;
        }
        const body = ctx.request.body as Record<string, unknown>;
        const { stateDir } = await calcUser(userId);
        const tasks = await readSchedule(stateDir);
        const existingIndex = tasks.findIndex((task) => task.id === name);
        const task = normalizeTask(name, body, existingIndex >= 0 ? tasks[existingIndex] : undefined);
        if (!task) {
            ctx.status = 400;
            ctx.body = { error: 'Valid cron and message are required' };
            return;
        }
        if (existingIndex >= 0) tasks[existingIndex] = task;
        else tasks.push(task);
        await writeSchedule(stateDir, tasks);
        await reloadSchedules();
        ctx.body = { ok: true, task };
    });

    router.patch('/api/crons/:name', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const body = ctx.request.body as Record<string, unknown>;
        const { stateDir } = await calcUser(userId);
        const tasks = await readSchedule(stateDir);
        const index = tasks.findIndex((task) => task.id === name);
        if (index < 0) {
            ctx.status = 404;
            ctx.body = { error: 'Task not found' };
            return;
        }
        const task = normalizeTask(name, body, tasks[index]);
        if (!task) {
            ctx.status = 400;
            ctx.body = { error: 'Valid cron and message are required' };
            return;
        }
        tasks[index] = task;
        await writeSchedule(stateDir, tasks);
        await reloadSchedules();
        ctx.body = { ok: true, task };
    });

    router.delete('/api/crons/:name', async (ctx) => {
        const userId = ctx.state.userId as string;
        const name = ctx.params.name ?? '';
        const { stateDir } = await calcUser(userId);
        await writeSchedule(stateDir, (await readSchedule(stateDir)).filter((task) => task.id !== name));
        await reloadSchedules();
        ctx.body = { ok: true };
    });
}
