import type { CronJob } from './_base.js';
import { generateDailyLogTool } from '../tools/generate-daily-log.js';

export const sessionLogCron: CronJob = {
    name: 'Session-to-Log',
    schedule: '59 23 * * *',
    handler: async (deps) => {
        const result = await generateDailyLogTool.handler({}, '');
        if (!result.startsWith('⏭️')) {
            await deps.sendReply(deps.chatId, result);
        }
    },
};
