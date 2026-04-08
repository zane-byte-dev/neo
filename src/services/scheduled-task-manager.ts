import type Database from 'better-sqlite3';
import type { TenantKey } from '../types/platform.js';
import cron, { ScheduledTask as CronJob } from 'node-cron';
import { geminiGenerate } from './gemini-client.js';

export interface ScheduledTask {
    id: string;
    chatId: string;
    content: string;    // short description shown in /schedules list
    prompt: string;     // the Gemini instruction executed each time
    cronExpr: string;   // standard 5-field cron expression
    createdAt: number;
    enabled: boolean;
}

type ExecuteCallback = (task: ScheduledTask) => Promise<void>;

/**
 * Uses Gemini to parse a natural-language recurring schedule description.
 * Returns { cronExpr, prompt, content } or null if not a recurring schedule request.
 */
export async function parseScheduledTask(
    text: string,
    apiKey: string
): Promise<{ cronExpr: string; prompt: string; content: string } | null> {
    const userPrompt = `你是一个定时任务解析助手。

用户发送了以下消息:
"${text}"

请判断这是否是一个设置【周期性/重复】定时任务的请求（区别于一次性提醒）。

周期性任务的特征关键词: 每天、每周、每月、每小时、每隔X分钟、定期、每个工作日、每周一 等。

如果是周期性定时任务，请提取:
1. cron_expr: 标准5字段 cron 表达式（分 时 日 月 周），例如 "0 9 * * *" 表示每天9:00
2. prompt: 届时要发给 AI 执行的完整指令，要具体且可独立执行（不含时间描述）
3. content: 简短中文描述，用于任务列表展示，格式如 "每天9点查询杭州天气"

常见示例:
- "每天早上9点告诉我杭州的天气" → {"is_schedule": true, "cron_expr": "0 9 * * *", "prompt": "查询杭州现在的天气，包括温度、体感温度和天气状况，用简洁友好的方式告诉我", "content": "每天9:00 查询杭州天气"}
- "每周一早上8点半汇报本周科技新闻" → {"is_schedule": true, "cron_expr": "30 8 * * 1", "prompt": "搜索并汇总本周最重要的5条科技新闻，简明扼要地报告给我", "content": "每周一8:30 科技新闻汇总"}
- "每两小时提醒我喝水" → {"is_schedule": true, "cron_expr": "0 */2 * * *", "prompt": "提醒我喝水，可以附上一句鼓励的话", "content": "每2小时 喝水提醒"}
- "每天下午6点检查比特币价格" → {"is_schedule": true, "cron_expr": "0 18 * * *", "prompt": "查询当前比特币(BTC)的价格（美元和人民币），以及今日涨跌幅", "content": "每天18:00 查询BTC价格"}

如果不是周期性定时任务（比如只是一次性提醒），返回 {"is_schedule": false}
如果无法理解，返回 {"is_schedule": false}

只输出 JSON，不要任何其他文字。`;

    try {
        const raw = await geminiGenerate(
            apiKey,
            [{ parts: [{ text: userPrompt }] }],
            { generationConfig: { responseMimeType: 'application/json', temperature: 0 } },
        );
        if (!raw) return null;
        const cleaned = raw.replace(/```(?:json)?/g, '').trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed.is_schedule || !parsed.cron_expr || !parsed.prompt || !parsed.content) return null;

        // Validate the cron expression before accepting it
        if (!cron.validate(parsed.cron_expr)) {
            console.warn('[ScheduledTask] Invalid cron from Gemini:', parsed.cron_expr);
            return null;
        }

        return {
            cronExpr: String(parsed.cron_expr).trim(),
            prompt: String(parsed.prompt).trim(),
            content: String(parsed.content).trim(),
        };
    } catch {
        return null;
    }
}

export class ScheduledTaskManager {
    private db: Database.Database;
    private tenantKey: TenantKey;
    private cronJobs = new Map<string, CronJob>();
    private onExecute?: ExecuteCallback;

    constructor(db: Database.Database, tenantKey: TenantKey) {
        this.db = db;
        this.tenantKey = tenantKey;
    }

    async init(onExecute: ExecuteCallback): Promise<void> {
        this.onExecute = onExecute;
        const rows = this.db.prepare(
            `SELECT id, chat_id, content, prompt, cron_expr, created_at FROM scheduled_tasks
             WHERE tenant_key = ? AND enabled = 1`
        ).all(this.tenantKey) as Array<{ id: string; chat_id: string; content: string; prompt: string; cron_expr: string; created_at: number }>;
        for (const row of rows) {
            this.scheduleJob(this.rowToTask(row));
        }
        console.log(`[ScheduledTaskManager] Ready (${rows.length} active task(s)).`);
    }

    async add(chatId: string, content: string, prompt: string, cronExpr: string): Promise<ScheduledTask> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const now = Date.now();
        this.db.prepare(
            `INSERT INTO scheduled_tasks (id, tenant_key, chat_id, content, prompt, cron_expr, created_at, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        ).run(id, this.tenantKey, chatId, content, prompt, cronExpr, now);
        const task: ScheduledTask = { id, chatId, content, prompt, cronExpr, createdAt: now, enabled: true };
        this.scheduleJob(task);
        console.log(`[ScheduledTaskManager] Added task #${id} (${cronExpr}): ${content}`);
        return task;
    }

    async cancel(id: string): Promise<boolean> {
        const result = this.db.prepare(
            `DELETE FROM scheduled_tasks WHERE id = ? AND tenant_key = ?`
        ).run(id, this.tenantKey);
        const job = this.cronJobs.get(id);
        if (job) {
            job.stop();
            this.cronJobs.delete(id);
        }
        return result.changes > 0;
    }

    getAll(): ScheduledTask[] {
        const rows = this.db.prepare(
            `SELECT id, chat_id, content, prompt, cron_expr, created_at FROM scheduled_tasks
             WHERE tenant_key = ? AND enabled = 1 ORDER BY created_at ASC`
        ).all(this.tenantKey) as Array<{ id: string; chat_id: string; content: string; prompt: string; cron_expr: string; created_at: number }>;
        return rows.map(r => this.rowToTask(r));
    }

    destroy(): void {
        for (const job of this.cronJobs.values()) job.stop();
        this.cronJobs.clear();
    }

    private scheduleJob(task: ScheduledTask): void {
        const job = cron.schedule(task.cronExpr, async () => {
            console.log(`[ScheduledTask] Executing #${task.id}: ${task.content}`);
            try {
                await this.onExecute?.(task);
            } catch (err: any) {
                console.error(`[ScheduledTask] Execute error for #${task.id}:`, err.message);
            }
        }, { timezone: 'Asia/Shanghai' });
        this.cronJobs.set(task.id, job);
    }

    private rowToTask(row: { id: string; chat_id: string; content: string; prompt: string; cron_expr: string; created_at: number }): ScheduledTask {
        return {
            id: row.id,
            chatId: row.chat_id,
            content: row.content,
            prompt: row.prompt,
            cronExpr: row.cron_expr,
            createdAt: row.created_at,
            enabled: true,
        };
    }
}
