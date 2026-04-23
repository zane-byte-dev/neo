/**
 * refresh-now.ts — 自动刷新用户的 NOW.md 记忆文件
 *
 * 读取最近 N 天的 daily log → 调用 LLM 提炼长期目标与近况 → 写回 NOW.md
 *
 * 由 cron-agent 每天 08:00 (Asia/Shanghai) 调用。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { GEMINI_API_KEY } from '../config.js';
import { userList } from './user-service.js';
import { log } from '../utils/logger.js';

const MODULE = 'RefreshNow';
const DAYS_BACK = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function recentDateStrings(n: number): string[] {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < n; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

async function readRecentLogs(dailyDir: string, dates: string[]): Promise<string> {
    const parts: string[] = [];
    for (const date of dates) {
        try {
            const content = await fs.readFile(join(dailyDir, `${date}.md`), 'utf-8');
            if (content.trim()) parts.push(content.trim());
        } catch { /* file doesn't exist */ }
    }
    return parts.join('\n\n---\n\n');
}

async function readNow(nowPath: string): Promise<string> {
    try {
        return await fs.readFile(nowPath, 'utf-8');
    } catch {
        return '';
    }
}

async function callLlm(currentNow: string, recentLogs: string): Promise<string> {
    const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
    const rawModel = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-preview-04-17';
    const model = google(rawModel);

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

// ── Per-user refresh ──────────────────────────────────────────────────────────

async function refreshUser(userId: string, workDir: string): Promise<void> {
    const dailyDir = join(workDir, '.neo', 'memory', '1-Daily');
    const nowPath  = join(workDir, '.neo', 'memory', 'NOW.md');

    const dates = recentDateStrings(DAYS_BACK);
    const logs  = await readRecentLogs(dailyDir, dates);

    if (!logs) {
        log.info(MODULE, `${userId}: no recent logs found, skipping`);
        return;
    }

    const currentNow = await readNow(nowPath);
    const updated    = await callLlm(currentNow, logs);
    const timestamp  = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const final      = `${updated}\n\n---\n*Auto-refreshed: ${timestamp}*\n`;

    await fs.writeFile(nowPath, final, 'utf-8');
    log.info(MODULE, `${userId}: NOW.md updated (${final.length} chars)`);
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function refreshNowForAllUsers(): Promise<void> {
    if (!GEMINI_API_KEY) {
        log.warn(MODULE, 'GEMINI_API_KEY not set, skipping refresh');
        return;
    }

    const users = userList().filter(u => u.workspaceDir);

    for (const user of users) {
        try {
            await refreshUser(user.id, user.workspaceDir!);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(MODULE, `${user.id}: failed — ${msg}`);
        }
    }
}
