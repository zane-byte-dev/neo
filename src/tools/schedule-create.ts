/**
 * schedule-create.ts — AI tool to create a new recurring scheduled task.
 *
 * Lets the AI autonomously create scheduled tasks during conversation,
 * without the user needing to use the /schedules command flow.
 */
import cron from 'node-cron';
import { getToolContext } from '../services/tool-context.js';
import type { Tool } from './_base.js';

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
    handler: async (args, _workDir) => {
        const cronExpr = String(args.cron_expr ?? '').trim();
        const prompt = String(args.prompt ?? '').trim();
        const content = String(args.content ?? '').trim();

        if (!cronExpr || !prompt || !content) {
            return '[Error] cron_expr, prompt, and content are all required';
        }

        if (!cron.validate(cronExpr)) {
            return `[Error] Invalid cron expression: "${cronExpr}". Use standard 5-field format: "M H DoM Mon DoW"`;
        }

        let ctx;
        try {
            ctx = getToolContext();
        } catch {
            return '[Error] schedule_create is not available in this context (bot not initialized)';
        }

        const chatId = ctx.chatId || parseInt(process.env.TELEGRAM_CHAT_ID || '0', 10);
        if (!chatId) return '[Error] Cannot determine chat ID for scheduled task';

        const task = await ctx.scheduledTaskManager.add(chatId, content, prompt, cronExpr);
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
