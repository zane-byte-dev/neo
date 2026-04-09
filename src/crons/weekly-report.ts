import type { CronJob } from './_base.js';
import { generateWeeklyReportTool } from '../tools/content/generate-weekly-report.js';

export const weeklyReportCron: CronJob = {
    name: 'Weekly report',
    description: '每周总结报告：回顾本周重要对话与事项',
    schedule: '0 21 * * 0',
    handler: async (deps) => {
        const result = await generateWeeklyReportTool.handler({}, '');
        if (!result.startsWith('⚠️')) {
            for (const tk of deps.tenantKeys) {
                await deps.sendReply(tk, result);
            }
        }
        return result;
    },
};
