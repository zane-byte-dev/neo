import type { CronJob } from './_base.js';
import { generateWeeklyReportTool } from '../tools/generate-weekly-report.js';

export const weeklyReportCron: CronJob = {
    name: 'Weekly report',
    schedule: '0 21 * * 0',
    handler: async (deps) => {
        const result = await generateWeeklyReportTool.handler({}, '');
        if (!result.startsWith('⚠️')) {
            for (const tk of deps.tenantKeys) {
                await deps.sendReply(tk, result);
            }
        }
    },
};
