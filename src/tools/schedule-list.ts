/**
 * schedule-list.ts — AI tool to list all recurring scheduled tasks.
 */
import type { Tool, ToolContext } from './_base.js';

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
