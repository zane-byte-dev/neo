/**
 * reminder-delete.ts — AI tool to cancel a reminder by ID.
 */
import { getToolContext } from '../lib/tool-context.js';
import type { Tool } from './_base.js';

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
    handler: async (args, _workDir) => {
        const id = String(args.id ?? '').trim();
        if (!id) return '[Error] id is required';

        let ctx;
        try {
            ctx = getToolContext();
        } catch {
            return '[Error] reminder_delete is not available in this context';
        }

        const deleted = await ctx.reminderManager.cancel(id);
        if (!deleted) return `[Error] 找不到 ID 为 "${id}" 的提醒。用 reminder_list 查看所有提醒。`;
        return `✅ 提醒 [${id}] 已取消。`;
    },
};
