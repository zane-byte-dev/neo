import type { CronJob } from './_base.js';
import { runButlerTool } from '../tools/run-butler.js';

export const butlerCron: CronJob = {
    name: 'Butler daily maintenance',
    schedule: '0 2 * * *',
    handler: async (deps) => {
        const report = await runButlerTool.handler({}, '');
        await deps.sendReply(deps.chatId, `📅 **每日管家巡检报告**:\n\n${report}`);
    },
};
