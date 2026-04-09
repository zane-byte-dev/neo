/**
 * schedule.ts — AI tools for recurring scheduled task management (create / list / delete).
 */
import cron from 'node-cron';
import { TELEGRAM_CHAT_ID } from '../../config.js';
import type { Tool, ToolContext } from '../_base.js';

export const scheduleCreateTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'schedule_create',
        description:
            '创建一个周期性定时任务（recurring schedule）。到时间会自动执行 prompt 并把结果发给用户。\n' +
            '参数：\n' +
            '• cron_expr: 标准 5 字段 cron 表达式（分 时 日 月 周），如 "0 9 * * *" 表示每天 9:00\n' +
            '• prompt: 届时发给 AI 执行的完整指令（要具体可独立执行）\n' +
            '• content: 任务的简短描述，用于列表展示，如 "每天 9:00 查询天气"',
        parameters: {
            type: 'object',
            properties: {
                cron_expr: {
                    type: 'string',
                    description: '5 字段 cron 表达式，如 "0 9 * * *"（每天9点）、"30 8 * * 1"（每周一8:30）',
                },
                prompt: {
                    type: 'string',
                    description: '届时执行的完整 AI 指令',
                },
                content: {
                    type: 'string',
                    description: '任务简短描述，如 "每天9:00 查询杭州天气"',
                },
            },
            required: ['cron_expr', 'prompt', 'content'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const cronExpr = String(args.cron_expr ?? '').trim();
        const prompt = String(args.prompt ?? '').trim();
        const content = String(args.content ?? '').trim();

        if (!cronExpr || !prompt || !content) {
            return '[Error] cron_expr, prompt, and content are all required';
        }

        if (!cron.validate(cronExpr)) {
            return `[Error] Invalid cron expression: "${cronExpr}". Use standard 5-field format: "M H DoM Mon DoW"`;
        }

        if (!context) {
            return '[Error] schedule_create is not available in this context (bot not initialized)';
        }

        const chatId = context.chatId || parseInt(TELEGRAM_CHAT_ID || '0', 10);
        if (!chatId) return '[Error] Cannot determine chat ID for scheduled task';

        const task = await context.scheduledTaskManager.add(chatId, content, prompt, cronExpr);
        return (
            `✅ 定时任务已创建！\n` +
            `🆔 ID: ${task.id}\n` +
            `📌 描述: ${content}\n` +
            `⏰ Cron: ${cronExpr}\n` +
            `📋 执行指令: ${prompt}\n\n` +
            `用 schedule_delete 或 /unschedule ${task.id} 可删除此任务`
        );
    },
};

export const scheduleListTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'schedule_list',
        description: '列出所有周期性定时任务，包括 ID、cron 表达式和描述。',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    handler: async (_args, _workDir, context?: ToolContext) => {
        if (!context) {
            return '[Error] schedule_list is not available in this context';
        }

        const tasks = context.scheduledTaskManager.getAll();
        if (tasks.length === 0) return '当前没有定时任务。';

        const lines = tasks.map((t: any) => {
            const created = new Date(t.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
            return `• [${t.id}] ${t.content}\n  ⏰ ${t.cronExpr}  📅 创建于 ${created}`;
        });

        return `共 ${tasks.length} 个定时任务：\n\n${lines.join('\n\n')}`;
    },
};

export const scheduleDeleteTool: Tool = {
    meta: { category: 'workspace', version: '1.0.0' },
    declaration: {
        name: 'schedule_delete',
        description: '删除一个周期性定时任务（按 ID）。先用 schedule_list 查看所有任务和 ID。',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: '要删除的任务 ID（从 schedule_list 获取）',
                },
            },
            required: ['id'],
        },
    },
    handler: async (args, _workDir, context?: ToolContext) => {
        const id = String(args.id ?? '').trim();
        if (!id) return '[Error] id is required';

        if (!context) {
            return '[Error] schedule_delete is not available in this context';
        }

        const deleted = await context.scheduledTaskManager.cancel(id);
        if (!deleted) return `[Error] 找不到 ID 为 "${id}" 的定时任务。用 schedule_list 查看所有任务。`;
        return `✅ 定时任务 [${id}] 已删除。`;
    },
};
