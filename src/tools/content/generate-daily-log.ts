/**
 * generate-daily-log.ts — Dehydrate today's chat into a structured daily log.
 *
 * Callable by:
 *   - Gemini agent (on demand)
 *   - Cron scheduler (nightly 23:59)
 *   - Session expire handler (mid-day)
 */
import { join } from 'path';
import { promises as fs } from 'fs';
import type { Tool, ToolContext } from '../_base.js';
import { callGemini } from '../../utils/helpers.js';
import { getDb } from '../../services/db.js';

function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

interface MessageRow {
    role: string;
    content: string;
    user_name: string | null;
    timestamp: string;
}

function loadTodayMessages(tenantKey: string): MessageRow[] {
    if (!tenantKey) return [];
    const db = getDb();
    const today = todayStr();
    return db.prepare(
        `SELECT m.role, m.content, m.user_name, m.timestamp
         FROM chat_messages m
         JOIN chat_sessions s ON m.session_id = s.id
         WHERE m.tenant_key = ? AND m.timestamp LIKE ?
         ORDER BY m.id ASC`
    ).all(tenantKey, `${today}%`) as MessageRow[];
}

export const generateDailyLogTool: Tool = {
    meta: { category: 'workspace', version: '2.0.0' },
    declaration: {
        name: 'generate_daily_log',
        description:
            '将今天的对话记录脱水提炼成结构化日记，写入 memory/1-Daily/YYYY-MM-DD.md。' +
            '如果日记已存在或今天没有对话则跳过（幂等）。',
        parameters: { type: 'object', properties: {}, required: [] },
    },
    handler: async (_args, workDir, context?: ToolContext) => {
        const vaultRoot = workDir;
        const today = todayStr();
        const outPath = join(vaultRoot, 'memory', '1-Daily', `${today}.md`);

        const tenantKey = context?.tenantKey ?? '';
        const messages = loadTodayMessages(tenantKey);
        if (messages.length === 0) {
            return `⏭️ 今天（${today}）没有对话记录，跳过。`;
        }

        const transcript = messages
            .map(m => {
                const speaker = m.role === 'user' ? (m.user_name ?? 'Me') : 'inkClaw';
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
        if (!summary) return '❌ Gemini 调用失败，日记未生成。';

        await fs.mkdir(join(vaultRoot, 'memory', '1-Daily'), { recursive: true });
        await fs.writeFile(outPath, summary, 'utf-8');

        return `📓 今日日记已更新：memory/1-Daily/${today}.md（${messages.length} 条消息 → ${summary.length} 字）`;
    },
};
