/**
 * session-to-log.ts — Session-to-Log nightly dehydration (23:59)
 *
 * Reads today's conversations from chat_history.json,
 * asks Gemini to distill them into a structured daily log,
 * and writes to WORK_DIR/1-Daily/YYYY-MM-DD.md.
 */
import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import type { CronJob } from './_base.js';
import { getVaultRoot, callGemini } from './_helpers.js';

function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
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
    const cacheDir = resolve(process.env.CHAT_CACHE_DIR || './cache');
    const cacheFile = join(cacheDir, 'chat_history.json');
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

export async function runSessionToLog(): Promise<string | null> {
    const vaultRoot = getVaultRoot();
    const today = todayStr();
    const outPath = join(vaultRoot, '1-Daily', `${today}.md`);

    // Idempotent: don't overwrite an existing file
    try {
        await fs.access(outPath);
        return null; // already exists
    } catch { /* file doesn't exist, proceed */ }

    const messages = await loadTodayMessages();
    if (messages.length === 0) return null;

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

    const summary = await callGemini(prompt, { temperature: 0.3 });
    if (!summary) return null;

    await fs.mkdir(join(vaultRoot, '1-Daily'), { recursive: true });
    await fs.writeFile(outPath, summary, 'utf-8');

    return `📓 [Session→Log] 今日日记已生成：1-Daily/${today}.md（${messages.length} 条消息 → ${summary.length} 字）`;
}

export const sessionLogCron: CronJob = {
    name: 'Session-to-Log',
    schedule: '59 23 * * *',
    handler: async (deps) => {
        const result = await runSessionToLog();
        if (result) {
            await deps.sendReply(deps.chatId, result);
        }
    },
};
