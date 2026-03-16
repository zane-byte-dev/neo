#!/usr/bin/env node
/**
 * weekly-report.ts — Sunday evening weekly aggregation
 *
 * Reads this week's daily log files from WORK_DIR/1-Daily/,
 * asks Gemini to synthesize a weekly review,
 * and pushes the result to stdout for the cron job to forward to Telegram.
 *
 * Called by the Sunday 21:00 cron in telegram-bot.ts:
 *   npx tsx apps/refinery/weekly-report.ts
 */

import { config } from 'dotenv';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');
config({ path: join(PROJECT_ROOT, '.env') });

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getVaultRoot(): string {
    const raw = process.env.WORK_DIR || '';
    return raw ? resolve(PROJECT_ROOT, raw) : PROJECT_ROOT;
}

/** Returns YYYY-MM-DD strings for the last 7 days (today inclusive). */
function lastSevenDays(): string[] {
    const days: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }));
    }
    return days;
}

/** ISO week number (Mon-Sun). */
function isoWeek(dateStr: string): number {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

async function callGemini(prompt: string): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
        console.error(`[WeeklyReport] Gemini ${res.status}`);
        return null;
    }
    const data = await res.json() as any;
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

async function run(): Promise<string> {
    const vaultRoot = getVaultRoot();
    const dailyDir = join(vaultRoot, '1-Daily');
    const days = lastSevenDays();

    const collected: Array<{ date: string; content: string }> = [];

    for (const day of days) {
        const filePath = join(dailyDir, `${day}.md`);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Trim very long entries to keep context manageable
            collected.push({ date: day, content: content.length > 2000 ? content.slice(0, 2000) + '...(截断)' : content });
        } catch {
            // File doesn't exist for that day — skip silently
        }
    }

    if (collected.length === 0) {
        return '⚠️ [週報] 本周没有找到任何日记文件（1-Daily/YYYY-MM-DD.md），无法生成周报。';
    }

    const todayStr = days[days.length - 1];
    const weekNum = isoWeek(todayStr);
    const yearStr = todayStr.slice(0, 4);

    const corpus = collected
        .map(({ date, content }) => `### ${date}\n\n${content}`)
        .join('\n\n---\n\n');

    const prompt = `你是 inkClaw 的主人的私人顾问，正在帮他做本周（${yearStr} 第 ${weekNum} 周）的复盘。

以下是本周的 ${collected.length} 篇日记记录：
---
${corpus}
---

请生成一份简洁有力的周报，格式如下（严格遵守）：

## 📅 ${yearStr} 第 ${weekNum} 周报（${collected[0].date} ~ ${todayStr}）

### 本周干了什么（3-5条）
- （列出本周实际完成的事项，不要废话）

### 本周卡在哪
- （列出未解决的问题、拖延项，如无则写"无"）

### 下周重点 1 件事
（只选一件最重要的事，一句话说清楚）

### 个人状态评估
（用 2-3 句评估本周精力/节奏/情绪状态，要诚实不要粉饰）

---
*由 inkClaw 自动生成 · ${todayStr}*`;

    const report = await callGemini(prompt);
    if (!report) {
        return `❌ [週報] Gemini 调用失败，周报未生成。`;
    }

    // Also persist the weekly report to 5-Output/
    const outDir = join(vaultRoot, '5-Output');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `week-${yearStr}-W${String(weekNum).padStart(2, '0')}.md`);
    await fs.writeFile(outPath, report, 'utf-8').catch(() => {});

    return report;
}

console.log(await run());
