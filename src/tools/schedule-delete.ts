/**
 * schedule-delete.ts — AI tool to delete a recurring scheduled task by ID.
 */
import { getToolContext } from '../services/tool-context.js';
import type { Tool } from './_base.js';

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
    handler: async (args, _workDir) => {
        const id = String(args.id ?? '').trim();
        if (!id) return '[Error] id is required';

        let ctx;
        try {
            ctx = getToolContext();
        } catch {
            return '[Error] schedule_delete is not available in this context';
        }

        const deleted = await ctx.scheduledTaskManager.cancel(id);
        if (!deleted) return `[Error] 找不到 ID 为 "${id}" 的定时任务。用 schedule_list 查看所有任务。`;
        return `✅ 定时任务 [${id}] 已删除。`;
    },
};
