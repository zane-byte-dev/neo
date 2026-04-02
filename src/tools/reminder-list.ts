/**
 * reminder-list.ts — AI tool to list all pending reminders.
 */
import { getToolContext } from '../lib/tool-context.js';
import type { Tool } from './_base.js';

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
    handler: async (_args, _workDir) => {
        let ctx;
        try {
            ctx = getToolContext();
        } catch {
            return '[Error] reminder_list is not available in this context';
        }

        const reminders: any[] = ctx.reminderManager.getAll().filter((r: any) => !r.fired);
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
