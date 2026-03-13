import { promises as fs } from 'fs';
import { join } from 'path';

export interface Reminder {
    id: string;
    chatId: number;
    content: string;
    fireAt: number;   // unix ms
    createdAt: number;
    fired: boolean;
}

type FireCallback = (reminder: Reminder) => Promise<void>;

/**
 * Parses a Chinese natural-language time expression and returns the fire timestamp.
 * Returns null if the message does not contain a recognisable time expression.
 *
 * Supported patterns (examples):
 *   10分钟后提醒我 xxx
 *   提醒我 2小时后 xxx
 *   提醒我 明天9点 xxx
 *   提醒我 明天下午3点半 xxx
 *   提醒我 今天22:30 xxx
 *   提醒我 后天8点 xxx
 *   提醒我 3天后 xxx
 */
export function parseReminderTime(text: string): { fireAt: number; content: string } | null {
    const now = new Date();

    // ── Relative: N分钟/小时/天后 ──────────────────────────────────────────
    const relMatch = text.match(/(\d+)\s*(分钟|小时|天)后/);
    if (relMatch) {
        const n = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        let ms = 0;
        if (unit === '分钟') ms = n * 60_000;
        else if (unit === '小时') ms = n * 3_600_000;
        else ms = n * 86_400_000;

        const fireAt = Date.now() + ms;
        const content = extractContent(text);
        return content ? { fireAt, content } : null;
    }

    // ── Absolute: 今天/明天/后天 + 时间 ────────────────────────────────────
    const dayMatch = text.match(/(今[天日]|明天|后天)/);
    const timeMatch = text.match(/(\d{1,2})[点时:：](\d{0,2})?(?:分)?|(\d{2}):(\d{2})/);

    if (dayMatch && timeMatch) {
        const dayWord = dayMatch[1];
        const base = new Date(now);
        if (dayWord === '明天') base.setDate(base.getDate() + 1);
        else if (dayWord === '后天') base.setDate(base.getDate() + 2);

        let hour = parseInt(timeMatch[1] ?? timeMatch[3], 10);
        const minute = parseInt(timeMatch[2] || timeMatch[4] || '0', 10);

        // 下午/晚上 modifier
        if (/下午|晚上|傍晚/.test(text) && hour < 12) hour += 12;
        // 上午/早上 modifier: leave as-is
        if (/早上|上午|凌晨/.test(text) && hour === 12) hour = 0;

        // Handle 半 as :30
        const adjMinute = /半/.test(text) && minute === 0 ? 30 : minute;

        base.setHours(hour, adjMinute, 0, 0);
        const fireAt = base.getTime();

        if (fireAt <= Date.now()) return null;   // time already passed

        const content = extractContent(text);
        return content ? { fireAt, content } : null;
    }

    return null;
}

/**
 * Strip all trigger phrases and time expressions from the text to get the reminder content.
 */
function extractContent(text: string): string {
    return text
        .replace(/提醒我/g, '')
        .replace(/(\d+)\s*(分钟|小时|天)后/g, '')
        .replace(/(今[天日]|明天|后天)/g, '')
        .replace(/(\d{1,2})[点时:：](\d{0,2})?(?:分)?/g, '')
        .replace(/(\d{2}):(\d{2})/g, '')
        .replace(/下午|晚上|傍晚|早上|上午|凌晨/g, '')
        .replace(/[半点]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
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

    async add(chatId: number, content: string, fireAt: number): Promise<Reminder> {
        const id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        const reminder: Reminder = { id, chatId, content, fireAt, createdAt: Date.now(), fired: false };
        this.reminders.set(id, reminder);
        await this.saveToDisk();
        console.log(`[ReminderManager] Added reminder #${id} for ${new Date(fireAt).toLocaleString('zh-CN')}`);
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
