import { promises as fs } from 'fs';
import { join } from 'path';
import { geminiGenerate } from './gemini-client.js';

export interface Reminder {
    id: string;
    chatId: number;
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
    private reminders = new Map<string, Reminder>();
    private dbPath: string;
    private timer: NodeJS.Timeout | null = null;
    private onFire?: FireCallback;

    constructor(cacheDir: string) {
        this.dbPath = join(cacheDir, 'reminders.json');
    }

    async init(onFire: FireCallback): Promise<void> {
        this.onFire = onFire;

        try {
            const data = await fs.readFile(this.dbPath, 'utf8');
            const items: Reminder[] = JSON.parse(data);
            for (const r of items) {
                if (!r.fired) this.reminders.set(r.id, r);
            }
            console.log(`[ReminderManager] Loaded ${this.reminders.size} active reminder(s).`);
        } catch (err: any) {
            if (err.code !== 'ENOENT') console.error('[ReminderManager] Load error:', err.message);
            await this.saveToDisk();
        }

        // Poll every 30 seconds
        this.timer = setInterval(() => this.tick(), 30_000);
    }

    async add(chatId: number, content: string, fireAt: number, prompt?: string): Promise<Reminder> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const reminder: Reminder = { id, chatId, content, prompt, fireAt, createdAt: Date.now(), fired: false };
        this.reminders.set(id, reminder);
        await this.saveToDisk();
        const type = prompt ? 'action' : 'notification';
        console.log(`[ReminderManager] Added ${type} reminder #${id} for ${new Date(fireAt).toLocaleString('zh-CN')}`);
        return reminder;
    }

    async cancel(id: string): Promise<boolean> {
        if (!this.reminders.has(id)) return false;
        this.reminders.delete(id);
        await this.saveToDisk();
        return true;
    }

    getAll(): Reminder[] {
        return Array.from(this.reminders.values()).sort((a, b) => a.fireAt - b.fireAt);
    }

    private async tick() {
        const now = Date.now();
        for (const reminder of this.reminders.values()) {
            if (reminder.fireAt <= now) {
                reminder.fired = true;
                this.reminders.delete(reminder.id);
                await this.saveToDisk();
                try {
                    await this.onFire?.(reminder);
                } catch (err: any) {
                    console.error(`[ReminderManager] Fire error for #${reminder.id}:`, err.message);
                }
            }
        }
    }

    private async saveToDisk() {
        try {
            const data = Array.from(this.reminders.values());
            await fs.writeFile(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (err: any) {
            console.error('[ReminderManager] Save error:', err.message);
        }
    }

    destroy() {
        if (this.timer) clearInterval(this.timer);
    }
}
