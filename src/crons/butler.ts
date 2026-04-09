import type { CronJob } from './_base.js';
import { runButlerTool } from '../tools/workspace/run-butler.js';

export const butlerCron: CronJob = {
    name: 'Butler daily maintenance',
    description: '每日管家巡检：清理过期数据、检查系统状态',
    schedule: '0 2 * * *',
    handler: async (deps) => {
        const report = await runButlerTool.handler({}, '');
        for (const tk of deps.tenantKeys) {
            await deps.sendReply(tk, `📅 **每日管家巡检报告**:\n\n${report}`);
        }
        return report;
    },
};
