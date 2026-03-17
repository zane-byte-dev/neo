/**
 * weekly-report.ts — Sunday evening weekly aggregation (21:00)
 *
 * Reads this week's daily log files from WORK_DIR/1-Daily/,
 * asks Gemini to synthesize a weekly review,
 * and persists it to 5-Output/.
 */
import { join } from 'path';
import { promises as fs } from 'fs';
import type { CronJob } from './_base.js';
import { getVaultRoot, callGemini } from './_helpers.js';

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

function isoWeek(dateStr: string): number {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export async function runWeeklyReport(): Promise<string | null> {
    const vaultRoot = getVaultRoot();
    const dailyDir = join(vaultRoot, '1-Daily');
    const days = lastSevenDays();

    const collected: Array<{ date: string; content: string }> = [];

    for (const day of days) {
        const filePath = join(dailyDir, `${day}.md`);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            collected.push({
                date: day,
                content: content.length > 2000 ? content.slice(0, 2000) + '...(截断)' : content,
            });
        } catch {
            // File doesn't exist for that day
        }
    }

    if (collected.length === 0) return null;

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

    const report = await callGemini(prompt, { maxOutputTokens: 1200 });
    if (!report) return null;

    // Persist the weekly report to 5-Output/
    const outDir = join(vaultRoot, '5-Output');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `week-${yearStr}-W${String(weekNum).padStart(2, '0')}.md`);
    await fs.writeFile(outPath, report, 'utf-8').catch(() => {});

    return `📊 **本周周报**\n\n${report}`;
}

export const weeklyReportCron: CronJob = {
    name: 'Weekly report',
    schedule: '0 21 * * 0',
    handler: async (deps) => {
        const result = await runWeeklyReport();
        if (result) {
            await deps.sendReply(deps.chatId, result);
        }
    },
};
