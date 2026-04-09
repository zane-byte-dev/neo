import type { CronJob } from './_base.js';
import { curateDiaryTool } from '../tools/content/curate-diary.js';

export const curatorCron: CronJob = {
    name: 'Curator daily briefing',
    description: '每日策展简报：整理昨日对话精华',
    schedule: '30 9 * * *',
    handler: async (deps) => {
        const results: string[] = [];
        for (const tk of deps.tenantKeys) {
            const workDir = deps.getWorkDir(tk);
            const result = await curateDiaryTool.handler({}, workDir);
            if (!result.startsWith('⚠️')) {
                await deps.sendReply(tk, result);
            }
            results.push(result);
        }
        return results.join('\n---\n');
    },
};
