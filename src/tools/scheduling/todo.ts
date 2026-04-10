/**
 * todo.ts — Unified AI tool for managing todos, reminders, and scheduled tasks.
 *
 * Replaces the previous three separate tools:
 *   - reminder_create / reminder_list / reminder_delete
 *   - schedule_create / schedule_list / schedule_delete
 *   - todo_write
 */
import cron from 'node-cron';
import type { Tool, ToolContext } from '../_base.js';

export const todoTool: Tool = {
    meta: { category: 'workspace', version: '3.0.0' },
    declaration: {
        name: 'todo',
        description:
            '统一的任务管理工具，支持普通待办、一次性提醒、周期性定时任务。\n\n' +
            '操作（action）：\n' +
            '• "list" — 列出任务。可选 filter: "all"(默认) / "todo" / "reminder" / "schedule"\n' +
            '• "add" — 新增。参数：content(必填), priority, prompt, fire_at, cron_expr\n' +
            '  - 仅 content → 普通待办\n' +
            '  - fire_at → 一次性提醒（可选 prompt，有则到时执行 AI 指令，无则纯通知）\n' +
            '  - cron_expr + prompt → 周期性定时任务\n' +
            '• "update" — 更新。参数：id(必填), 可选 status/content/priority/prompt/enabled\n' +
            '• "delete" — 删除。参数：id(必填)\n' +
            '• "clear_done" — 清除所有已完成的普通待办',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '"list" | "add" | "update" | "delete" | "clear_done"',
                },
                filter: {
                    type: 'string',
                    description: 'list 时过滤: "all" | "todo" | "reminder" | "schedule"',
                },
                content: { type: 'string', description: '任务内容 (add 时必填)' },
                id: { type: 'string', description: '任务 ID (update/delete 时必填)' },
                status: { type: 'string', description: '"pending" | "in_progress" | "done" | "blocked"' },
                priority: { type: 'string', description: '"high" | "medium" | "low"' },
                prompt: { type: 'string', description: 'AI 执行指令（提醒/定时任务触发时执行）' },
                fire_at: { type: 'string', description: '一次性触发时间 ISO 8601，如 "2026-04-03T09:00:00+08:00"' },
                cron_expr: { type: 'string', description: '周期性 cron 表达式，如 "0 9 * * *"' },
                enabled: { type: 'string', description: '"true" | "false"（启用/禁用周期任务）' },
            },
            required: ['action'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        if (!context?.todoManager) return '[Error] todo tool requires todoManager in context';
        const tm = context.todoManager;
        const action = String(args.action ?? '');

        switch (action) {
            case 'list': {
                const filter = String(args.filter ?? 'all');
                let items: any[];
                switch (filter) {
                    case 'todo': items = tm.getTodos(); break;
                    case 'reminder': items = tm.getReminders(); break;
                    case 'schedule': items = tm.getSchedules(); break;
                    default: items = tm.getAll(); break;
                }
                if (items.length === 0) return filter === 'all' ? '任务清单为空。' : `没有 ${filter} 类型的任务。`;

                const lines = items.map((t: any) => {
                    const icons: Record<string, string> = { pending: '⬜', in_progress: '🔄', done: '✅', blocked: '🚫' };
                    const icon = icons[t.status] ?? '?';
                    let detail = '';
                    if (t.cronExpr) {
                        detail = ` ⏰ ${t.cronExpr}`;
                    } else if (t.fireAt && !t.fired) {
                        detail = ` 🕐 ${new Date(t.fireAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
                    }
                    const prio = t.priority ? ` (${t.priority})` : '';
                    return `${icon} [${t.id}] ${t.content}${prio}${detail}`;
                });
                return lines.join('\n');
            }

            case 'add': {
                const content = String(args.content ?? '').trim();
                if (!content) return '[Error] content is required for add';

                const priority = args.priority as string | undefined;
                if (priority && !['high', 'medium', 'low'].includes(priority)) {
                    return '[Error] priority must be high, medium, or low';
                }

                const fireAtStr = args.fire_at ? String(args.fire_at).trim() : undefined;
                let fireAt: number | undefined;
                if (fireAtStr) {
                    fireAt = new Date(fireAtStr).getTime();
                    if (isNaN(fireAt)) return `[Error] Invalid fire_at: "${fireAtStr}". Use ISO 8601 format.`;
                    if (fireAt <= Date.now()) return `[Error] fire_at must be in the future. Current: ${new Date().toISOString()}`;
                }

                const cronExpr = args.cron_expr ? String(args.cron_expr).trim() : undefined;
                if (cronExpr && !cron.validate(cronExpr)) {
                    return `[Error] Invalid cron expression: "${cronExpr}". Use 5-field format: "M H DoM Mon DoW"`;
                }

                const prompt = args.prompt ? String(args.prompt).trim() : undefined;
                if (cronExpr && !prompt) return '[Error] cron_expr requires prompt (the AI instruction to execute each time)';

                const todo = tm.add({
                    content,
                    priority: priority ?? null,
                    prompt: prompt ?? null,
                    fireAt: fireAt ?? null,
                    cronExpr: cronExpr ?? null,
                });

                if (cronExpr) {
                    return `✅ 定时任务已创建\n🆔 ${todo.id}\n📌 ${content}\n⏰ ${cronExpr}\n📋 ${prompt}\n\n用 todo delete 或 /unschedule ${todo.id} 删除`;
                } else if (fireAt) {
                    const fireStr = new Date(fireAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                    const typeLabel = prompt ? '⚡ 定时任务' : '🔔 提醒';
                    return `✅ ${typeLabel}已创建\n🆔 ${todo.id}\n📌 ${content}\n🕐 ${fireStr}${prompt ? `\n📋 ${prompt}` : ''}\n\n用 todo delete 或 /remindcancel ${todo.id} 取消`;
                } else {
                    return `✅ 已添加待办 [${todo.id}]: ${content}`;
                }
            }

            case 'update': {
                const id = String(args.id ?? '');
                if (!id) return '[Error] id is required for update';

                const patch: Record<string, any> = {};
                if (args.status !== undefined) {
                    const s = String(args.status);
                    if (!['pending', 'in_progress', 'done', 'blocked'].includes(s)) {
                        return `[Error] status must be: pending, in_progress, done, blocked`;
                    }
                    patch.status = s;
                }
                if (args.content !== undefined) patch.content = String(args.content);
                if (args.priority !== undefined) patch.priority = args.priority;
                if (args.prompt !== undefined) patch.prompt = args.prompt;
                if (args.enabled !== undefined) patch.enabled = String(args.enabled) === 'true';

                const ok = tm.patch(id, patch);
                if (!ok) return `[Error] Todo [${id}] not found`;
                return `✅ [${id}] 已更新`;
            }

            case 'delete': {
                const id = String(args.id ?? '');
                if (!id) return '[Error] id is required for delete';
                const ok = tm.delete(id);
                if (!ok) return `[Error] Todo [${id}] not found`;
                return `✅ 已删除 [${id}]`;
            }

            case 'clear_done': {
                const count = tm.clearDone();
                return `✅ 已清除 ${count} 个已完成任务`;
            }

            default:
                return `[Error] Unknown action "${action}". Use: list, add, update, delete, clear_done`;
        }
    },
};
