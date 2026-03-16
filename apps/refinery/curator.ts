#!/usr/bin/env node
/**
 * curator.ts — Daily curation script
 *
 * Randomly picks an archived diary from history/YYYY/MM/ and asks Gemini to
 * write a short curated reflection bridging that past entry to today.
 *
 * Called by the 09:30 AM cron job in telegram-bot.ts via:
 *   npx tsx apps/refinery/curator.ts
 *
 * Prints the result to stdout so the cron job can forward it to Telegram.
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

/**
 * Collect all .md files under history/YYYY/MM/ sub-directories.
 */
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

async function callGemini(prompt: string): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[Curator] Gemini API error ${res.status}: ${errText}`);
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

async function runCurator(): Promise<string> {
    const vaultRoot = getVaultRoot();
    const archives = await getArchivedDiaries(vaultRoot);

    if (archives.length === 0) {
        return '⚠️ [策展人] 未在归档库 (history/YYYY/MM) 中发现任何旧日记，无法完成策展。';
    }

    const selectedFile = archives[Math.floor(Math.random() * archives.length)];
    // Extract just the filename stem (e.g. "2025-08-14")
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

    console.error(`[Curator] 正在召唤策展人... (精选文件: ${fileName})`);

    const response = await callGemini(prompt);
    if (!response) {
        return `❌ [策展人] 唤醒失败或无思考产出`;
    }

    return `🕰️ **时空连线：来自 \`${fileName}.md\` 的只言片语**\n\n${response}\n\n---\n_*(由 inkClaw 策展代理自动从归档区中挖掘并精炼)*_`;
}

console.log(await runCurator());
