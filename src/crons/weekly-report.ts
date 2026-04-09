import type { CronJob } from './_base.js';
import { generateWeeklyReportTool } from '../tools/content/generate-weekly-report.js';

export const weeklyReportCron: CronJob = {
    name: 'Weekly report',
    description: '每周总结报告：回顾本周重要对话与事项',
    schedule: '0 21 * * 0',
    handler: async (deps) => {
        const results: string[] = [];
        for (const tk of deps.tenantKeys) {
            const workDir = deps.getWorkDir(tk);
            const result = await generateWeeklyReportTool.handler({}, workDir);
            if (!result.startsWith('⚠️')) {
                await deps.sendReply(tk, result);
            }
            results.push(result);
        }
        return results.join('\n---\n');
    },
};
