/**
 * scripts/refresh-now.ts — 自动刷新用户的 NOW.md 记忆文件
 *
 * 读取最近 N 天的 daily log → 调用 LLM 提炼长期目标与近况 → 写回 NOW.md
 *
 * 用法（手动执行）:
 *   npx tsx scripts/refresh-now.ts [--user <userId>] [--days <n>] [--dry-run]
 *
 * PM2 定时执行（见 ecosystem.config.cjs）:
 *   cron_restart: '0 8 * * *'  — 每天早上 8 点执行
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const MODEL_ALIASES: Record<string, string> = {
    flash: 'gemini-3-flash-preview',
    pro:   'gemini-3-pro-preview',
};

// ── CLI 参数 ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) {
                out[key] = true;
            } else {
                out[key] = next;
                i++;
            }
        }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const TARGET_USER  = args['user'] ? String(args['user']) : undefined;
const DAYS_BACK    = args['days'] ? parseInt(String(args['days']), 10) : 4;
const DRY_RUN      = !!args['dry-run'];

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SPACE_DIR  = resolve(__dirname, '../space');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

if (!GEMINI_API_KEY) {
    console.error('[refresh-now] GEMINI_API_KEY not set, exiting.');
    process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get date strings for the last N days, descending (today first) */
function recentDateStrings(n: number): string[] {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < n; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
    }
    return dates;
}

/** Read available daily logs for the given date strings */
async function readRecentLogs(dailyDir: string, dates: string[]): Promise<string> {
    const parts: string[] = [];
    for (const date of dates) {
        try {
            const content = await fs.readFile(join(dailyDir, `${date}.md`), 'utf-8');
            if (content.trim()) parts.push(content.trim());
        } catch { /* file doesn't exist, skip */ }
    }
    return parts.join('\n\n---\n\n');
}

/** Read current NOW.md (may not exist) */
async function readNow(nowPath: string): Promise<string> {
    try {
        return await fs.readFile(nowPath, 'utf-8');
    } catch {
        return '';
    }
}

// ── LLM ───────────────────────────────────────────────────────────────────────

async function refreshNow(currentNow: string, recentLogs: string): Promise<string> {
    const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
    const rawModel = process.env.GEMINI_MODEL ?? 'flash';
    const modelId  = MODEL_ALIASES[rawModel] ?? rawModel;
    const model    = google(modelId);

    const prompt = [
        '你是一个记忆整理助手。根据以下近期日记内容，更新用户的 NOW.md 记忆文件。',
        '',
        'NOW.md 的用途：记录用户的长期目标、当前阶段近况、优先级。它是每次对话的背景参考，不是任务清单。',
        '',
        '要求：',
        '- 保留 # Mission（长期目标，除非明显变化否则维持原文）',
        '- 更新 # Priorities（根据近期日记调整优先级排序和内容）',
        '- 更新 # Status（反映近期日记中的进展和变化）',
        '- 不要加 # Today 板块',
        '- 语言简洁，每条一行，不超过 2 句',
        '- 只输出 Markdown 内容本身，不要解释',
        '',
        '## 当前 NOW.md',
        currentNow || '（空）',
        '',
        '## 近期日记',
        recentLogs || '（无最近日记）',
    ].join('\n');

    const { text } = await generateText({ model, prompt, temperature: 0.3 });
    return text.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function refreshUser(userId: string): Promise<void> {
    const workDir  = join(SPACE_DIR, userId);
    const dailyDir = join(workDir, '.neo', 'memory', 'daily');
    const nowPath  = join(workDir, '.neo', 'memory', 'NOW.md');

    const dates     = recentDateStrings(DAYS_BACK);
    const logs      = await readRecentLogs(dailyDir, dates);
    const currentNow = await readNow(nowPath);

    if (!logs) {
        console.log(`[refresh-now] ${userId}: no recent logs found, skipping.`);
        return;
    }

    console.log(`[refresh-now] ${userId}: found logs for dates: ${dates.filter(d => logs.includes(d)).join(', ')}`);

    const updated = await refreshNow(currentNow, logs);

    const tz = Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' });
    const timestamp = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const final = `${updated}\n\n---\n*Auto-refreshed: ${timestamp}*\n`;

    if (DRY_RUN) {
        console.log(`[refresh-now] DRY RUN — would write to ${nowPath}:\n${final}`);
        return;
    }

    await fs.writeFile(nowPath, final, 'utf-8');
    console.log(`[refresh-now] ${userId}: NOW.md updated (${final.length} chars).`);
}

async function main(): Promise<void> {
    // Discover users: subdirectories of space/ that have a memory/daily/ folder
    let userIds: string[];

    if (TARGET_USER) {
        userIds = [TARGET_USER];
    } else {
        const entries = await fs.readdir(SPACE_DIR, { withFileTypes: true });
        userIds = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => e.name);
    }

    for (const userId of userIds) {
        try {
            await refreshUser(userId);
        } catch (err) {
            console.error(`[refresh-now] ${userId}: error —`, err instanceof Error ? err.message : err);
        }
    }
}

main().catch((err) => {
    console.error('[refresh-now] Fatal:', err);
    process.exit(1);
});
