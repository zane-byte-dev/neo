import type { CronJob } from './_base.js';
import { generateDailyLogTool } from '../tools/generate-daily-log.js';

export const sessionLogCron: CronJob = {
    name: 'Session-to-Log',
    description: '每日会话归档：将当天聊天记录写入日志',
    schedule: '59 23 * * *',
    handler: async (deps) => {
        const result = await generateDailyLogTool.handler({}, '');
        if (!result.startsWith('⏭️')) {
            for (const tk of deps.tenantKeys) {
                await deps.sendReply(tk, result);
            }
        }
        return result;
    },
};
