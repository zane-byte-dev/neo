import type { CronJob } from './_base.js';
import { curateDiaryTool } from '../tools/content/curate-diary.js';

export const curatorCron: CronJob = {
    name: 'Curator daily briefing',
    description: '每日策展简报：整理昨日对话精华',
    schedule: '30 9 * * *',
    handler: async (deps) => {
        const result = await curateDiaryTool.handler({}, '');
        if (!result.startsWith('⚠️')) {
            for (const tk of deps.tenantKeys) {
                await deps.sendReply(tk, result);
            }
        }
        return result;
    },
};
