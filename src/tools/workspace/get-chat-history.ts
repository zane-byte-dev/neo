/**
 * get-chat-history.ts — Read chat messages from the current tenant's session.
 *
 * Used by skills (brief, generate-daily-log) that need the conversation
 * transcript but run in a fresh agentLoop without history context.
 */
import { getDb } from '../../services/db.js';
import type { Tool, ToolContext } from '../_base.js';

interface MessageRow {
    role: string;
    content: string;
    user_name: string | null;
    timestamp: string;
}

function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

export const getChatHistoryTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'get_chat_history',
        description:
            '获取当前用户的对话记录。默认返回今天的全部消息；可指定日期或限制条数。\n' +
            '主要供技能（skill）使用，以便在独立 agentLoop 中访问会话历史。',
        parameters: {
            type: 'object',
            properties: {
                date: {
                    type: 'string',
                    description: '日期（格式 YYYY-MM-DD，默认今天）',
                },
                limit: {
                    type: 'number',
                    description: '最多返回的消息条数（默认 100）',
                },
            },
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const tenantKey = context?.tenantKey ?? '';
        if (!tenantKey) return '[get_chat_history] No tenant context available.';

        const date = String(args.date ?? todayStr());
        const limit = Math.min(Number(args.limit ?? 100), 500);

        const db = getDb();
        const rows = db.prepare(
            `SELECT m.role, m.content, m.user_name, m.timestamp
             FROM chat_messages m
             JOIN chat_sessions s ON m.session_id = s.id
             WHERE m.tenant_key = ? AND m.timestamp LIKE ?
             ORDER BY m.id ASC
             LIMIT ?`
        ).all(tenantKey, `${date}%`, limit) as MessageRow[];

        if (rows.length === 0) {
            return `没有找到 ${date} 的对话记录。`;
        }

        const transcript = rows
            .map(m => {
                const speaker = m.role === 'user' ? (m.user_name ?? '用户') : 'AI';
                const body = m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content;
                return `[${speaker}]: ${body}`;
            })
            .join('\n\n');

        return `# 对话记录（${date}，共 ${rows.length} 条）\n\n${transcript}`;
    },
};
