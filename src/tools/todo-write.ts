/**
 * todo-write.ts — Structured todo list management tool (SQLite-backed).
 *
 * AI can maintain a persistent checklist across turns:
 * - Create / update / delete items
 * - Track status: pending / in_progress / done / blocked
 * Scoped per tenant_key via the active tenant context.
 */
import type { Tool, ToolContext } from './_base.js';
import { getDb } from '../services/db.js';

type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

interface TodoRow {
    id: string;
    content: string;
    status: string;
    priority: string | null;
    created_at: string;
    updated_at: string;
}

// tenantKey is now passed via ToolContext

function makeId(): string {
    return Math.random().toString(36).slice(2, 8);
}

function formatList(rows: TodoRow[]): string {
    if (rows.length === 0) return '(empty)';
    const icons: Record<string, string> = {
        pending: '⬜', in_progress: '🔄', done: '✅', blocked: '🚫',
    };
    return rows
        .map(t => `${icons[t.status] ?? '?'} [${t.id}] ${t.content}${t.priority ? ` (${t.priority})` : ''}`)
        .join('\n');
}

export const todoWriteTool: Tool = {
    meta: { category: 'workspace', version: '2.0.0' },
    declaration: {
        name: 'todo_write',
        description:
            '管理结构化任务清单（Todo List）。AI 应在处理多步骤任务时使用此工具跟踪进度。\n' +
            '操作（action）：\n' +
            '• "list" — 查看所有任务\n' +
            '• "add" — 新增任务（需要 content，可选 priority: high/medium/low）\n' +
            '• "update" — 更新状态（需要 id 和 status: pending/in_progress/done/blocked）\n' +
            '• "delete" — 删除任务（需要 id）\n' +
            '• "clear_done" — 清除已完成任务\n' +
            '建议：任务开始前设为 in_progress，完成后设为 done。',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', description: '"list" | "add" | "update" | "delete" | "clear_done"' },
                content: { type: 'string', description: '任务内容（add 时必填）' },
                id: { type: 'string', description: '任务 ID（update/delete 时必填）' },
                status: { type: 'string', description: '"pending" | "in_progress" | "done" | "blocked"' },
                priority: { type: 'string', description: '"high" | "medium" | "low"（可选）' },
            },
            required: ['action'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const db = getDb();
        if (!context?.tenantKey) throw new Error('[todo-write] No tenant key in context');
        const tenantKey = context.tenantKey;
        const action = String(args.action ?? '');

        switch (action) {
            case 'list': {
                const rows = db.prepare(
                    `SELECT id, content, status, priority, created_at, updated_at FROM todos
                     WHERE tenant_key = ? ORDER BY created_at ASC`
                ).all(tenantKey) as TodoRow[];
                const byStatus = (s: string) => rows.filter(r => r.status === s);
                const sections: string[] = [];
                const inProgress = byStatus('in_progress');
                const pending = byStatus('pending');
                const blocked = byStatus('blocked');
                const done = byStatus('done');
                if (inProgress.length) sections.push(`🔄 进行中:\n${formatList(inProgress)}`);
                if (pending.length) sections.push(`⬜ 待处理:\n${formatList(pending)}`);
                if (blocked.length) sections.push(`🚫 阻塞:\n${formatList(blocked)}`);
                if (done.length) sections.push(`✅ 已完成:\n${formatList(done)}`);
                return sections.length ? sections.join('\n\n') : '任务清单为空。';
            }

            case 'add': {
                const content = String(args.content ?? '').trim();
                if (!content) return '[Error] content is required for add action';
                const priority = args.priority as string | undefined;
                const validPriorities = ['high', 'medium', 'low', undefined];
                if (!validPriorities.includes(priority)) return '[Error] priority must be high, medium, or low';
                const id = makeId();
                const now = new Date().toISOString();
                db.prepare(
                    `INSERT INTO todos (id, tenant_key, content, status, priority, created_at, updated_at)
                     VALUES (?, ?, ?, 'pending', ?, ?, ?)`
                ).run(id, tenantKey, content, priority ?? null, now, now);
                return `✅ 已添加任务 [${id}]: ${content}`;
            }

            case 'update': {
                const id = String(args.id ?? '');
                const status = String(args.status ?? '') as TodoStatus;
                if (!id) return '[Error] id is required for update action';
                const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'done', 'blocked'];
                if (!validStatuses.includes(status)) return `[Error] status must be one of: ${validStatuses.join(', ')}`;
                const result = db.prepare(
                    `UPDATE todos SET status = ?, updated_at = ? WHERE id = ? AND tenant_key = ?`
                ).run(status, new Date().toISOString(), id, tenantKey);
                if (result.changes === 0) return `[Error] Todo [${id}] not found`;
                return `✅ [${id}] → ${status}`;
            }

            case 'delete': {
                const id = String(args.id ?? '');
                if (!id) return '[Error] id is required for delete action';
                const result = db.prepare(
                    `DELETE FROM todos WHERE id = ? AND tenant_key = ?`
                ).run(id, tenantKey);
                if (result.changes === 0) return `[Error] Todo [${id}] not found`;
                return `✅ 已删除任务 [${id}]`;
            }

            case 'clear_done': {
                const result = db.prepare(
                    `DELETE FROM todos WHERE tenant_key = ? AND status = 'done'`
                ).run(tenantKey);
                return `✅ 已清除 ${result.changes} 个已完成任务`;
            }

            default:
                return `[Error] Unknown action "${action}". Use: list, add, update, delete, clear_done`;
        }
    },
};
