/**
 * reminder.ts — AI tools for one-time reminder management (create / list / delete).
 */
import { TELEGRAM_CHAT_ID } from '../../config.js';
import type { Tool, ToolContext } from '../_base.js';

export const reminderCreateTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'reminder_create',
        description:
            '创建一个一次性提醒或定时任务（到时间后触发一次）。\n' +
            '参数：\n' +
            '• fire_at: 触发时间，ISO 8601 格式（如 "2026-04-03T09:00:00+08:00"）\n' +
            '• content: 简短描述，用于列表展示（如 "喝水提醒"）\n' +
            '• prompt: 可选，触发时发给 AI 执行的完整指令。留空则只发通知消息。\n' +
            '注意：触发时间必须在未来。使用 get_datetime 工具确认当前时间。',
        parameters: {
            type: 'object',
            properties: {
                fire_at: {
                    type: 'string',
                    description: 'ISO 8601 触发时间，如 "2026-04-03T09:00:00+08:00"',
                },
                content: {
                    type: 'string',
                    description: '简短描述，如 "下午3点喝水"',
                },
                prompt: {
                    type: 'string',
                    description: '（可选）到时间后 AI 执行的完整指令。不填则仅发通知。',
                },
            },
            required: ['fire_at', 'content'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const fireAtStr = String(args.fire_at ?? '').trim();
        const content = String(args.content ?? '').trim();
        const prompt = args.prompt ? String(args.prompt).trim() : undefined;

        if (!fireAtStr || !content) {
            return '[Error] fire_at and content are required';
        }

        const fireAt = new Date(fireAtStr).getTime();
        if (isNaN(fireAt)) {
            return `[Error] Invalid fire_at: "${fireAtStr}". Use ISO 8601 format, e.g. "2026-04-03T09:00:00+08:00"`;
        }
        if (fireAt <= Date.now()) {
            return `[Error] fire_at must be in the future. Current time: ${new Date().toISOString()}`;
        }

        if (!context) {
            return '[Error] reminder_create is not available in this context';
        }

        const chatId = context.chatId || parseInt(TELEGRAM_CHAT_ID || '0', 10);
        if (!chatId) return '[Error] Cannot determine chat ID';

        const reminder = await context.reminderManager.add(chatId, content, fireAt, prompt);
        const fireStr = new Date(fireAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
        const typeLabel = prompt ? '⚡ 定时任务' : '🔔 提醒通知';
        const promptLine = prompt ? `\n📋 执行指令: ${prompt}` : '';

        return (
            `✅ ${typeLabel}已创建！\n` +
            `🆔 ID: ${reminder.id}\n` +
            `📌 内容: ${content}${promptLine}\n` +
            `🕐 触发时间: ${fireStr}\n\n` +
            `用 reminder_delete 或 /remindcancel ${reminder.id} 可取消`
        );
    },
};

export const reminderListTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'reminder_list',
        description: '列出所有待触发的提醒，包括 ID、内容和触发时间。',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    handler: async (_args, _workDir, context?: ToolContext) => {
        if (!context) {
            return '[Error] reminder_list is not available in this context';
        }

        const reminders: any[] = context.reminderManager.getAll().filter((r: any) => !r.fired);
        if (reminders.length === 0) return '当前没有待触发的提醒。';

        const lines = reminders.map((r: any) => {
            const fireStr = new Date(r.fireAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });
            const typeIcon = r.prompt ? '⚡' : '🔔';
            return `${typeIcon} [${r.id}] ${r.content}\n  🕐 ${fireStr}`;
        });

        return `共 ${reminders.length} 个待触发提醒：\n\n${lines.join('\n\n')}`;
    },
};

export const reminderDeleteTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'reminder_delete',
        description: '取消一个提醒（按 ID）。先用 reminder_list 查看所有提醒和 ID。',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要取消的提醒 ID（从 reminder_list 获取）',
                },
            },
            required: ['id'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const id = String(args.id ?? '').trim();
        if (!id) return '[Error] id is required';

        if (!context) {
            return '[Error] reminder_delete is not available in this context';
        }

        const deleted = await context.reminderManager.cancel(id);
        if (!deleted) return `[Error] 找不到 ID 为 "${id}" 的提醒。用 reminder_list 查看所有提醒。`;
        return `✅ 提醒 [${id}] 已取消。`;
    },
};
