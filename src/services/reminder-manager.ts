import type Database from 'better-sqlite3';
import { geminiGenerate } from '../llm/providers/gemini/index.js';

export interface Reminder {
    id: string;
    chatId: string;
    content: string;      // brief display text for listings / simple notification
    prompt?: string;      // if set, execute this as a Gemini task when reminder fires
    fireAt: number;       // unix ms
    createdAt: number;
    fired: boolean;
}

type FireCallback = (reminder: Reminder) => Promise<void>;

/**
 * Uses Gemini to parse a natural-language reminder expression.
 * Returns { fireAt, content } or null if the text is not a reminder.
 */
export async function parseReminderTime(
    text: string,
    apiKey: string
): Promise<{ fireAt: number; content: string; prompt?: string } | null> {
    const now = new Date();
    const nowStr = now.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'long',
    });

    const prompt = `你是一个智能提醒解析助手。当前时间是: ${nowStr}

用户发送了以下消息:
"${text}"

请判断这是否是一个设置提醒/定时任务的请求，分两类:

【类型A: 纯提醒通知】—— 只需到时间推送一条通知，不需要执行任何查询。
  例: "提醒我下午3点喝水", "明天早上9点提醒我开会"
  返回: {"is_reminder": true, "fire_at": "ISO时间", "is_action": false, "content": "喝水"}

【类型B: 定时执行任务】—— 到时间后需要实际去查询/执行某件事并返回结果给用户。
  例: "1分钟后告诉我杭州的天气", "半小时后帮我总结今天的科技新闻", "5分钟后查一下比特币价格"
  返回: {"is_reminder": true, "fire_at": "ISO时间", "is_action": true, "prompt": "查询杭州现在的实时天气，告诉我温度和天气状况", "content": "查询杭州天气"}
  注意: prompt 是届时要发给 AI 执行的完整指令，要具体清晰；content 是简短描述（用于列表显示）。

如果不是提醒请求，或者无法确定时间，返回 {"is_reminder": false}

只输出 JSON，不要任何其他文字。`;

    try {
        const raw = await geminiGenerate(
            apiKey,
            [{ parts: [{ text: prompt }] }],
            { generationConfig: { responseMimeType: 'application/json', temperature: 0 } },
        );
        if (!raw) return null;
        const cleaned = raw.replace(/```(?:json)?/g, '').trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed.is_reminder || !parsed.fire_at || !parsed.content) return null;

        const fireAt = new Date(parsed.fire_at).getTime();
        if (isNaN(fireAt) || fireAt <= Date.now()) return null;

        const result: { fireAt: number; content: string; prompt?: string } = {
            fireAt,
            content: String(parsed.content).trim(),
        };
        if (parsed.is_action && parsed.prompt) {
            result.prompt = String(parsed.prompt).trim();
        }
        return result;
    } catch {
        return null;
    }
}

export class ReminderManager {
    private db: Database.Database;
    private scopeKey: string;
    private timer: NodeJS.Timeout | null = null;
    private onFire?: FireCallback;

    constructor(db: Database.Database, scopeKey: string) {
        this.db = db;
        this.scopeKey = scopeKey;
    }

    async init(onFire: FireCallback): Promise<void> {
        this.onFire = onFire;
        const count = (this.db.prepare(
            `SELECT COUNT(*) as n FROM reminders WHERE tenant_key = ? AND fired = 0`
        ).get(this.scopeKey) as { n: number }).n;
        console.log(`[ReminderManager|${this.scopeKey}] Ready (${count} active reminder(s)).`);
        this.timer = setInterval(() => this.tick(), 30_000);
    }

    async add(chatId: string, content: string, fireAt: number, prompt?: string): Promise<Reminder> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const now = Date.now();
        this.db.prepare(
            `INSERT INTO reminders (id, tenant_key, chat_id, content, prompt, fire_at, created_at, fired)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
        ).run(id, this.scopeKey, chatId, content, prompt ?? null, fireAt, now);
        const type = prompt ? 'action' : 'notification';
        console.log(`[ReminderManager|${this.scopeKey}] Added ${type} reminder #${id} for ${new Date(fireAt).toLocaleString('zh-CN')}`);
        return { id, chatId, content, prompt, fireAt, createdAt: now, fired: false };
    }

    async cancel(id: string): Promise<boolean> {
        const result = this.db.prepare(
            `DELETE FROM reminders WHERE id = ? AND tenant_key = ?`
        ).run(id, this.scopeKey);
        return result.changes > 0;
    }

    getAll(): Reminder[] {
        const rows = this.db.prepare(
            `SELECT id, chat_id, content, prompt, fire_at, created_at FROM reminders
             WHERE tenant_key = ? AND fired = 0 ORDER BY fire_at ASC`
        ).all(this.scopeKey) as Array<{ id: string; chat_id: string; content: string; prompt: string | null; fire_at: number; created_at: number }>;
        return rows.map(r => ({
            id: r.id,
            chatId: r.chat_id,
            content: r.content,
            prompt: r.prompt ?? undefined,
            fireAt: r.fire_at,
            createdAt: r.created_at,
            fired: false,
        }));
    }

    private async tick(): Promise<void> {
        const now = Date.now();
        const due = this.db.prepare(
            `SELECT id, chat_id, content, prompt, fire_at, created_at FROM reminders
             WHERE tenant_key = ? AND fired = 0 AND fire_at <= ?`
        ).all(this.scopeKey, now) as Array<{ id: string; chat_id: string; content: string; prompt: string | null; fire_at: number; created_at: number }>;

        for (const row of due) {
            this.db.prepare(`UPDATE reminders SET fired = 1 WHERE id = ?`).run(row.id);
            const reminder: Reminder = {
                id: row.id,
                chatId: row.chat_id,
                content: row.content,
                prompt: row.prompt ?? undefined,
                fireAt: row.fire_at,
                createdAt: row.created_at,
                fired: true,
            };
            try {
                await this.onFire?.(reminder);
            } catch (err: any) {
                console.error(`[ReminderManager] Fire error for #${row.id}:`, err.message);
            }
        }
    }

    destroy(): void {
        if (this.timer) clearInterval(this.timer);
    }
}
