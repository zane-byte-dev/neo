import type { CronJob } from './_base.js';
import { generateDailyLogTool } from '../tools/content/generate-daily-log.js';

export const sessionLogCron: CronJob = {
    name: 'Session-to-Log',
    description: '每日会话归档：将当天聊天记录写入日志',
    schedule: '59 23 * * *',
    handler: async (deps) => {
        const results: string[] = [];
        for (const tk of deps.tenantKeys) {
            const workDir = deps.getWorkDir(tk);
            const result = await generateDailyLogTool.handler({}, workDir);
            if (!result.startsWith('⏭️')) {
                await deps.sendReply(tk, result);
            }
            results.push(result);
        }
        return results.join('\n---\n');
    },
};
