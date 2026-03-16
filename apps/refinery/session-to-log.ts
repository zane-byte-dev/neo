#!/usr/bin/env node
/**
 * session-to-log.ts — Session-to-Log nightly dehydration
 *
 * Reads today's conversations from chat_history.json,
 * asks Gemini to distill them into a structured daily log,
 * and writes to WORK_DIR/1-Daily/YYYY-MM-DD.md.
 *
 * Skips the run silently if there are no messages from today,
 * or if a daily file already exists (idempotent).
 *
 * Called by the 23:59 cron in telegram-bot.ts:
 *   npx tsx apps/refinery/session-to-log.ts
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

function getCacheDir(): string {
    const raw = process.env.CHAT_CACHE_DIR || './cache';
    return resolve(PROJECT_ROOT, raw);
}

function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); // YYYY-MM-DD
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
    userName?: string;
    timestamp: string;
}

interface Session {
    sessionId: string;
    startTime: string;
    endTime: string;
    messages: Message[];
}

async function loadTodayMessages(): Promise<Message[]> {
    const cacheFile = join(getCacheDir(), 'chat_history.json');
    const today = todayStr();

    let raw: string;
    try {
        raw = await fs.readFile(cacheFile, 'utf-8');
    } catch {
        return [];
    }

    const { sessions } = JSON.parse(raw) as { sessions: Session[] };
    const messages: Message[] = [];

    for (const session of sessions) {
        for (const msg of session.messages) {
            if (msg.timestamp.startsWith(today)) {
                messages.push(msg);
            }
        }
    }
    return messages;
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
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

async function run(): Promise<string> {
    const vaultRoot = getVaultRoot();
    const today = todayStr();
    const outPath = join(vaultRoot, '1-Daily', `${today}.md`);

    // Idempotent: don't overwrite an existing file
    try {
        await fs.access(outPath);
        return `⏭️ [Session→Log] ${today}.md 已存在，跳过。`;
    } catch { /* file doesn't exist, proceed */ }

    const messages = await loadTodayMessages();
    if (messages.length === 0) {
        return `⏭️ [Session→Log] 今天（${today}）没有对话记录，跳过。`;
    }

    // Build transcript for Gemini
    const transcript = messages
        .map(m => {
            const speaker = m.role === 'user' ? (m.userName ?? 'Me') : 'inkClaw';
            const body = m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content;
            return `${speaker}: ${body}`;
        })
        .join('\n\n');

    const prompt = `你是一个私人助理，正在将今天（${today}）的对话记录脱水提炼成日记骨架。

以下是今天完整的对话记录：
---
${transcript}
---

请输出一份结构化的日记条目，格式如下（严格遵守，不要多余的解释）：

# ${today}

## 今日要点
- （用 2-5 条干练的 bullet 总结今天讨论/完成的主要事项）

## 关键决策
- （如无则写"无"）

## 待跟进
- （从对话中提取未完成的行动项，如无则写"无"）

## 原始碎片
（保留 1-3 条今天最值得记录的原始对话片段或观点，每条不超过 2 行）

---
*由 inkClaw Session-to-Log 自动生成 · ${today}*`;

    const summary = await callGemini(prompt);
    if (!summary) {
        return `❌ [Session→Log] Gemini 调用失败，日记未生成。`;
    }

    await fs.mkdir(join(vaultRoot, '1-Daily'), { recursive: true });
    await fs.writeFile(outPath, summary, 'utf-8');

    return `📓 [Session→Log] 今日日记已生成：1-Daily/${today}.md（${messages.length} 条消息 → ${summary.length} 字）`;
}

console.log(await run());
