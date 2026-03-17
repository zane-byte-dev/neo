/**
 * curator.ts — Daily curation cron (09:30 AM)
 *
 * Randomly picks an archived diary from history/YYYY/MM/
 * and asks Gemini to write a curated reflection bridging that past entry to today.
 */
import { join } from 'path';
import { promises as fs } from 'fs';
import type { CronJob } from './_base.js';
import { getVaultRoot, callGemini } from './_helpers.js';

async function getArchivedDiaries(vaultRoot: string): Promise<string[]> {
    const historyDir = join(vaultRoot, 'history');
    const allFiles: string[] = [];

    let years: string[];
    try {
        years = await fs.readdir(historyDir);
    } catch {
        return [];
    }

    for (const year of years) {
        if (!/^\d{4}$/.test(year)) continue;
        const yearPath = join(historyDir, year);
        const months = await fs.readdir(yearPath).catch(() => [] as string[]);
        for (const month of months) {
            const monthPath = join(yearPath, month);
            const files = await fs.readdir(monthPath).catch(() => [] as string[]);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    allFiles.push(join(monthPath, file));
                }
            }
        }
    }
    return allFiles;
}

async function runCurator(): Promise<string | null> {
    const vaultRoot = getVaultRoot();
    const archives = await getArchivedDiaries(vaultRoot);

    if (archives.length === 0) return null;

    const selectedFile = archives[Math.floor(Math.random() * archives.length)];
    const fileName = selectedFile.split('/').pop()!.replace('.md', '');

    let content = await fs.readFile(selectedFile, 'utf-8');
    if (content.length > 3000) {
        content = content.slice(0, 3000) + '... (内容已截断)';
    }

    const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const prompt = `[任务：每日策展]
时间线：这里有一篇尘封在历史归档中的旧日记，写于【${fileName}】。
内容如下：
---
${content}
---

要求：
1. 请你以"策展人"(Curator)的身份阅读这篇旧日记。
2. 从中萃取出 1-2 个闪光点或者和当下（${today}）有跨时空连线意义的内容。
3. 请以温和、睿智的老友口吻，写一段 100-200 字以内的点评和感悟，通过你的导读将它推给我。
4. 语言必须干净、直接，切忌长篇大论。`;

    const response = await callGemini(prompt, { temperature: 0.8, maxOutputTokens: 512 });
    if (!response) return null;

    return `🕰️ **时空连线：来自 \`${fileName}.md\` 的只言片语**\n\n${response}\n\n---\n_*(由 inkClaw 策展代理自动从归档区中挖掘并精炼)*_`;
}

export const curatorCron: CronJob = {
    name: 'Curator daily briefing',
    schedule: '30 9 * * *',
    handler: async (deps) => {
        const result = await runCurator();
        if (result) {
            await deps.sendReply(deps.chatId, result);
        }
    },
};
