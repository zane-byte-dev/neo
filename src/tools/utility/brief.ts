/**
 * brief.ts — Generate a concise summary of the current conversation.
 *
 * Reads today's session messages and produces a short status update.
 * Useful for long tasks to provide mid-task progress reports.
 */
import { callGemini } from '../../utils/helpers.js';
import type { Tool, ToolContext } from '../_base.js';
import { getDb } from '../../services/db.js';

interface MessageRow {
    role: string;
    content: string;
    timestamp: string;
}

function getRecentMessages(tenantKey: string, limit = 20): MessageRow[] {
    if (!tenantKey) return [];
    const db = getDb();
    // Get current session id for this tenant
    const session = db.prepare(
        `SELECT id FROM chat_sessions WHERE tenant_key = ? AND is_current = 1`
    ).get(tenantKey) as { id: string } | undefined;
    if (!session) return [];
    return db.prepare(
        `SELECT role, content, timestamp FROM chat_messages
         WHERE session_id = ? ORDER BY id DESC LIMIT ?`
    ).all(session.id, limit) as MessageRow[];
}

export const briefTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'brief',
        description:
            '生成当前对话/任务的简洁状态摘要。在长任务中途汇报进度时使用。\n' +
            '返回：已完成的事项、当前状态、下一步计划（如有）。',
        parameters: {
            type: 'object',
            properties: {
                focus: {
                    type: 'string',
                    description: '摘要的关注点，如 "已完成的步骤"、"遇到的问题"（可选）',
                },
            },
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const focus = args.focus ? String(args.focus) : null;
        const tenantKey = context?.tenantKey ?? '';
        const messages = getRecentMessages(tenantKey, 30);

        if (messages.length === 0) {
            return '当前没有对话记录可以摘要。';
        }

        const transcript = messages
            .map(m => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content.slice(0, 300)}`)
            .join('\n');

        const focusLine = focus ? `\n关注点：${focus}` : '';
        const prompt = `以下是最近的对话记录，请生成一个简洁的状态摘要（150字以内）。${focusLine}

摘要应包含：
- 已完成的主要事项
- 当前状态
- 下一步（如果对话中有明确的后续任务）

对话记录：
${transcript}`;

        const summary = await callGemini(prompt, { temperature: 0.3, maxOutputTokens: 300 });
        return summary ?? '无法生成摘要（API 调用失败）。';
    },
};
