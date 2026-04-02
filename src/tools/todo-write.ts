/**
 * todo-write.ts — Structured todo list management tool.
 *
 * AI can maintain a persistent checklist across turns:
 * - Create / update / delete items
 * - Track status: pending / in_progress / done / blocked
 * Stored in CHAT_CACHE_DIR/todos.json
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import type { Tool } from './_base.js';

type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

interface TodoItem {
    id: string;
    content: string;
    status: TodoStatus;
    priority?: 'high' | 'medium' | 'low';
    createdAt: string;
    updatedAt: string;
}

function getDbPath(): string {
    const cacheDir = process.env.CHAT_CACHE_DIR || './cache';
    return join(cacheDir, 'todos.json');
}

async function loadTodos(): Promise<TodoItem[]> {
    try {
        const raw = await fs.readFile(getDbPath(), 'utf8');
        return JSON.parse(raw) as TodoItem[];
    } catch {
        return [];
    }
}

async function saveTodos(items: TodoItem[]): Promise<void> {
    const path = getDbPath();
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, JSON.stringify(items, null, 2), 'utf8');
}

function makeId(): string {
    return Math.random().toString(36).slice(2, 8);
}

function formatList(items: TodoItem[]): string {
    if (items.length === 0) return '(empty)';
    const icons: Record<TodoStatus, string> = {
        pending: '⬜',
        in_progress: '🔄',
        done: '✅',
        blocked: '🚫',
    };
    return items
        .map(t => `${icons[t.status]} [${t.id}] ${t.content}${t.priority ? ` (${t.priority})` : ''}`)
        .join('\n');
}

export const todoWriteTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
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
                action: {
                    type: 'string',
                    description: '"list" | "add" | "update" | "delete" | "clear_done"',
                },
                content: {
                    type: 'string',
                    description: '任务内容（add 时必填）',
                },
                id: {
                    type: 'string',
                    description: '任务 ID（update/delete 时必填）',
                },
                status: {
                    type: 'string',
                    description: '"pending" | "in_progress" | "done" | "blocked"',
                },
                priority: {
                    type: 'string',
                    description: '"high" | "medium" | "low"（可选）',
                },
            },
            required: ['action'],
        },
    },
    handler: async (args, _workDir) => {
        const action = String(args.action ?? '');
        const items = await loadTodos();

        switch (action) {
            case 'list': {
                const pending = items.filter(t => t.status === 'pending');
                const inProgress = items.filter(t => t.status === 'in_progress');
                const done = items.filter(t => t.status === 'done');
                const blocked = items.filter(t => t.status === 'blocked');

                const sections: string[] = [];
                if (inProgress.length) sections.push(`🔄 进行中:\n${formatList(inProgress)}`);
                if (pending.length) sections.push(`⬜ 待处理:\n${formatList(pending)}`);
                if (blocked.length) sections.push(`🚫 阻塞:\n${formatList(blocked)}`);
                if (done.length) sections.push(`✅ 已完成:\n${formatList(done)}`);

                return sections.length ? sections.join('\n\n') : '任务清单为空。';
            }

            case 'add': {
                const content = String(args.content ?? '').trim();
                if (!content) return '[Error] content is required for add action';
                const priority = args.priority as TodoItem['priority'] | undefined;
                const validPriorities = ['high', 'medium', 'low', undefined];
                if (!validPriorities.includes(priority)) return `[Error] priority must be high, medium, or low`;

                const now = new Date().toISOString();
                const item: TodoItem = {
                    id: makeId(),
                    content,
                    status: 'pending',
                    priority,
                    createdAt: now,
                    updatedAt: now,
                };
                items.push(item);
                await saveTodos(items);
                return `✅ 已添加任务 [${item.id}]: ${content}`;
            }

            case 'update': {
                const id = String(args.id ?? '');
                const status = String(args.status ?? '') as TodoStatus;
                if (!id) return '[Error] id is required for update action';
                const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'done', 'blocked'];
                if (!validStatuses.includes(status)) return `[Error] status must be one of: ${validStatuses.join(', ')}`;

                const idx = items.findIndex(t => t.id === id);
                if (idx === -1) return `[Error] Todo [${id}] not found`;

                items[idx].status = status;
                items[idx].updatedAt = new Date().toISOString();
                await saveTodos(items);
                return `✅ [${id}] → ${status}`;
            }

            case 'delete': {
                const id = String(args.id ?? '');
                if (!id) return '[Error] id is required for delete action';
                const before = items.length;
                const filtered = items.filter(t => t.id !== id);
                if (filtered.length === before) return `[Error] Todo [${id}] not found`;
                await saveTodos(filtered);
                return `✅ 已删除任务 [${id}]`;
            }

            case 'clear_done': {
                const filtered = items.filter(t => t.status !== 'done');
                const removed = items.length - filtered.length;
                await saveTodos(filtered);
                return `✅ 已清除 ${removed} 个已完成任务`;
            }

            default:
                return `[Error] Unknown action "${action}". Use: list, add, update, delete, clear_done`;
        }
    },
};
