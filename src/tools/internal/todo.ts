/**
 * todo.ts — Task tracker for the AI agent with session and persistent scope.
 *
 * Lets the agent plan, track, and update a lightweight todo list.
 * Two scopes:
 *   - session (default): stored in {workDir}/.tmp/{sessionId}/todos.json
 *   - persistent: stored in {workDir}/memory/tasks.json — survives across sessions
 */
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Tool, ToolContext } from '../_base.js';

interface TodoItem {
    id: number;
    title: string;
    status: 'not-started' | 'in-progress' | 'completed';
}

function sessionTodosPath(workDir: string, sessionId: string): string {
    return join(workDir, '.tmp', sessionId, 'todos.json');
}

function persistentTodosPath(workDir: string): string {
    return join(workDir, 'memory', 'tasks.json');
}

function todosPath(workDir: string, sessionId: string, scope: string): string {
    return scope === 'persistent'
        ? persistentTodosPath(workDir)
        : sessionTodosPath(workDir, sessionId);
}

async function loadTodos(workDir: string, sessionId: string, scope = 'session'): Promise<TodoItem[]> {
    try {
        const raw = await fs.readFile(todosPath(workDir, sessionId, scope), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function saveTodos(
    workDir: string,
    sessionId: string,
    todos: TodoItem[],
    scope = 'session',
    context?: ToolContext,
): Promise<void> {
    const p = todosPath(workDir, sessionId, scope);
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(todos, null, 2), 'utf-8');
    // Push real-time update to the client via SSE (session scope only)
    if (scope === 'session') {
        context?.todoCallback?.(todos);
    }
}

function formatTodos(todos: TodoItem[], scope = 'session'): string {
    if (todos.length === 0) return '（当前没有待办事项）';
    const icons: Record<string, string> = {
        'not-started': '⬜',
        'in-progress': '🔄',
        'completed': '✅',
    };
    const header = scope === 'persistent' ? '📌 持久任务列表' : '📋 会话任务列表';
    const lines = todos
        .map(t => `${icons[t.status] ?? '⬜'} [${t.id}] ${t.title} (${t.status})`)
        .join('\n');
    return `${header}\n\n${lines}`;
}

export const todoTool: Tool = {
    meta: { category: 'utility', version: '2.0.0', permission: 'write' },
    declaration: {
        name: 'todo',
        description:
            '管理任务追踪列表，支持会话级和持久级两种作用域。\n' +
            '• scope=session（默认）— 当前会话内的任务，会话结束后消失\n' +
            '• scope=persistent — 跨会话的持久任务，适合长期项目和 GTD\n\n' +
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
                scope: {
                    type: 'string',
                    enum: ['session', 'persistent'],
                    description: '作用域：session（默认，当前会话）或 persistent（跨会话持久化）',
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
        const scope = String(args.scope ?? 'session').trim();

        // ── LIST
        if (action === 'list') {
            const todos = await loadTodos(workDir, sessionId, scope);
            return formatTodos(todos, scope);
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
            await saveTodos(workDir, sessionId, items, scope, context);
            return `✅ Todo 列表已更新（${items.length} 项）\n\n${formatTodos(items, scope)}`;
        }

        // ── UPDATE (single item status)
        if (action === 'update') {
            if (args.id == null) return '[Error] update 需要 id';
            if (!args.status) return '[Error] update 需要 status';
            const todos = await loadTodos(workDir, sessionId, scope);
            const item = todos.find(t => t.id === Number(args.id));
            if (!item) return `[Error] 未找到 id=${args.id} 的任务`;
            item.status = String(args.status) as TodoItem['status'];
            await saveTodos(workDir, sessionId, todos, scope, context);
            return `✅ 任务 [${item.id}] "${item.title}" → ${item.status}\n\n${formatTodos(todos, scope)}`;
        }

        // ── ADD
        if (action === 'add') {
            const title = String(args.title ?? '').trim();
            if (!title) return '[Error] add 需要 title';
            const todos = await loadTodos(workDir, sessionId, scope);
            const maxId = todos.reduce((m, t) => Math.max(m, t.id), 0);
            const newItem: TodoItem = { id: maxId + 1, title, status: 'not-started' };
            todos.push(newItem);
            await saveTodos(workDir, sessionId, todos, scope, context);
            return `✅ 已添加: [${newItem.id}] ${title}\n\n${formatTodos(todos, scope)}`;
        }

        return `[Error] 未知 action: "${action}"`;
    },
};
