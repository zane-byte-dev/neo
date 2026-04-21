/**
 * get-chat-history.ts — Expose past chat messages to the agent.
 *
 * Skills like `generate_daily_log` and `brief` need to look back at recent
 * conversation. We give them a structured, read-only entry point instead of
 * forcing them to `bash cat .tmp/**\/chat-*.jsonl`.
 *
 * Modes:
 *   scope=current  (default) — current session
 *   scope=session  session_id=<id> — specific session
 *   scope=date     date=YYYY-MM-DD — all messages across sessions on that day
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolContext } from '../_base.js';

interface MessageRow {
    id: number;
    session_id: string;
    role: string;
    content: string;
    timestamp: string;
}

async function readSessionsList(workDir: string): Promise<Array<{ id: string; start_time: string }>> {
    try {
        const raw = await fs.readFile(join(workDir, '.tmp', 'chat-sessions.json'), 'utf8');
        const data = JSON.parse(raw) as { sessions?: Record<string, { id: string; start_time: string }> };
        return Object.values(data.sessions ?? {});
    } catch {
        return [];
    }
}

async function readSessionMessages(workDir: string, sessionId: string): Promise<MessageRow[]> {
    const f = join(workDir, '.tmp', sessionId, `chat-${sessionId}.jsonl`);
    try {
        const raw = await fs.readFile(f, 'utf8');
        return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as MessageRow);
    } catch {
        return [];
    }
}

function formatMessages(msgs: MessageRow[], limit = 200): string {
    if (!msgs.length) return '（无匹配消息）';
    const slice = msgs.slice(-limit);
    return slice.map((m) => {
        const who = m.role === 'assistant' || m.role === 'model' ? '🤖' : '👤';
        const ts = m.timestamp?.slice(0, 16).replace('T', ' ') ?? '';
        return `${who} [${ts}] ${m.content}`;
    }).join('\n\n');
}

export const getChatHistoryTool: Tool = {
    meta: { category: 'utility', version: '1.0.0', permission: 'read' },
    declaration: {
        name: 'get_chat_history',
        description:
            '读取历史对话消息。用于日志、周报、brief 等需要回看对话的场景。\n' +
            '• scope=current（默认）— 读取当前会话的消息\n' +
            '• scope=session — 读取指定 session_id 的会话\n' +
            '• scope=date — 读取某一天跨所有会话的消息（按 YYYY-MM-DD 过滤 timestamp）',
        parameters: {
            type: 'object',
            properties: {
                scope: { type: 'string', enum: ['current', 'session', 'date'], description: '查询范围' },
                session_id: { type: 'string', description: '[scope=session] 目标 session id' },
                date: { type: 'string', description: '[scope=date] 日期 YYYY-MM-DD（默认今天）' },
                limit: { type: 'number', description: '最多返回几条（默认 200）' },
            },
        },
    },

    handler: async (args, workDir, context?: ToolContext) => {
        const scope = String(args.scope ?? 'current');
        const limit = Number(args.limit ?? 200);

        if (scope === 'current') {
            const sid = context?.sessionId;
            if (!sid) return '[Error] 当前没有活动会话（scope=current 需要运行时 sessionId）';
            const msgs = await readSessionMessages(workDir, sid);
            return `📜 当前会话 (${sid}) 共 ${msgs.length} 条:\n\n${formatMessages(msgs, limit)}`;
        }

        if (scope === 'session') {
            const sid = String(args.session_id ?? '').trim();
            if (!sid) return '[Error] scope=session 需要 session_id';
            const msgs = await readSessionMessages(workDir, sid);
            return `📜 会话 (${sid}) 共 ${msgs.length} 条:\n\n${formatMessages(msgs, limit)}`;
        }

        if (scope === 'date') {
            const dateStr = String(args.date ?? new Date().toISOString().slice(0, 10));
            const sessions = await readSessionsList(workDir);
            const all: MessageRow[] = [];
            for (const s of sessions) {
                const msgs = await readSessionMessages(workDir, s.id);
                for (const m of msgs) {
                    if (m.timestamp?.startsWith(dateStr)) all.push(m);
                }
            }
            all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            return `📜 ${dateStr} 共 ${all.length} 条消息（跨 ${sessions.length} 个 session）:\n\n${formatMessages(all, limit)}`;
        }

        return `[Error] 未知 scope: "${scope}"`;
    },
};
