/**
 * todo.ts — In-session task tracker for the AI agent.
 *
 * Lets the agent plan, track, and update a lightweight todo list within a
 * session. Stored in memory as a JSON file: {workDir}/.tmp/{sessionId}/todos.json
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../_base.js';

interface TodoItem {
    id: number;
    title: string;
    status: 'not-started' | 'in-progress' | 'completed';
}

function todosPath(workDir: string, sessionId: string): string {
    return join(workDir, '.tmp', sessionId, 'todos.json');
}

async function loadTodos(workDir: string, sessionId: string): Promise<TodoItem[]> {
    try {
        const raw = await fs.readFile(todosPath(workDir, sessionId), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function saveTodos(workDir: string, sessionId: string, todos: TodoItem[]): Promise<void> {
    const p = todosPath(workDir, sessionId);
    await fs.mkdir(join(workDir, '.tmp', sessionId), { recursive: true });
    await fs.writeFile(p, JSON.stringify(todos, null, 2), 'utf-8');
}

function formatTodos(todos: TodoItem[]): string {
    if (todos.length === 0) return '（当前没有待办事项）';
    const icons: Record<string, string> = {
        'not-started': '⬜',
        'in-progress': '🔄',
        'completed': '✅',
    };
    return todos
        .map(t => `${icons[t.status] ?? '⬜'} [${t.id}] ${t.title} (${t.status})`)
        .join('\n');
}

export const todoTool: Tool = {
    meta: { category: 'utility', version: '1.0.0' },
    declaration: {
        name: 'todo',
        description:
            '管理当前会话的任务追踪列表。用于规划多步骤任务、追踪进度。\n' +
            '• action=list   — 查看所有任务\n' +
            '• action=write  — 覆盖整个列表（传入 items JSON 数组）\n' +
            '• action=update — 更新单个任务的状态（传入 id + status）\n' +
            '• action=add    — 添加一个新任务（传入 title）',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'write', 'update', 'add'],
                    description: '操作类型',
                },
                items: {
                    type: 'string',
                    description:
                        '[write] 完整的 todo 列表 JSON 数组，格式: [{"id":1,"title":"...","status":"not-started"}]',
                },
                id: {
                    type: 'number',
                    description: '[update] 要更新的任务 ID',
                },
                status: {
                    type: 'string',
                    enum: ['not-started', 'in-progress', 'completed'],
                    description: '[update] 新状态',
                },
                title: {
                    type: 'string',
                    description: '[add] 新任务标题',
                },
            },
            required: ['action'],
        },
    },

    handler: async (args, workDir, context) => {
        const sessionId = context?.sessionId;
        if (!sessionId) return '[Error] sessionId is required';

        const action = String(args.action ?? '').trim();

        // ── LIST
        if (action === 'list') {
            const todos = await loadTodos(workDir, sessionId);
            return `# 📋 Todo List\n\n${formatTodos(todos)}`;
        }

        // ── WRITE (replace entire list)
        if (action === 'write') {
            const raw = String(args.items ?? '[]');
            let items: TodoItem[];
            try {
                items = JSON.parse(raw);
                if (!Array.isArray(items)) throw new Error('not an array');
            } catch {
                return '[Error] items 必须是有效的 JSON 数组';
            }
            await saveTodos(workDir, sessionId, items);
            return `✅ Todo 列表已更新（${items.length} 项）\n\n${formatTodos(items)}`;
        }

        // ── UPDATE (single item status)
        if (action === 'update') {
            if (args.id == null) return '[Error] update 需要 id';
            if (!args.status) return '[Error] update 需要 status';
            const todos = await loadTodos(workDir, sessionId);
            const item = todos.find(t => t.id === Number(args.id));
            if (!item) return `[Error] 未找到 id=${args.id} 的任务`;
            item.status = String(args.status) as TodoItem['status'];
            await saveTodos(workDir, sessionId, todos);
            return `✅ 任务 [${item.id}] "${item.title}" → ${item.status}\n\n${formatTodos(todos)}`;
        }

        // ── ADD
        if (action === 'add') {
            const title = String(args.title ?? '').trim();
            if (!title) return '[Error] add 需要 title';
            const todos = await loadTodos(workDir, sessionId);
            const maxId = todos.reduce((m, t) => Math.max(m, t.id), 0);
            const newItem: TodoItem = { id: maxId + 1, title, status: 'not-started' };
            todos.push(newItem);
            await saveTodos(workDir, sessionId, todos);
            return `✅ 已添加: [${newItem.id}] ${title}\n\n${formatTodos(todos)}`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};
