import type { CronJob } from './_base.js';
import { curateDiaryTool } from '../tools/curate-diary.js';

export const curatorCron: CronJob = {
    name: 'Curator daily briefing',
    schedule: '30 9 * * *',
    handler: async (deps) => {
        const result = await curateDiaryTool.handler({}, '');
        if (!result.startsWith('⚠️')) {
            await deps.sendReply(deps.chatId, result);
        }
    },
};
