import cron from 'node-cron';
import { execa } from 'execa';
import { join } from 'path';
import { CRON_SCHEDULES } from '../config.js';

interface CronDeps {
    authorizedChatId: number | null;
    sendReply: (chatId: number, text: string, retries?: number, replyToMessageId?: number) => Promise<void>;
}

export function setupCronJobs(deps: CronDeps) {
    const { authorizedChatId, sendReply } = deps;
    if (!authorizedChatId) {
        console.log('[System] No AUTHORIZED_CHAT_ID found. Cron jobs disabled.');
        return;
    }

    const projectRoot = process.cwd();
    const vaultEnv = { ...process.env };

    cron.schedule(CRON_SCHEDULES.butler, async () => {
        console.log('[Cron] Execution starting: Butler daily maintenance');
        try {
            const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/butler.ts')], { env: vaultEnv });
            await sendReply(authorizedChatId, `📅 **每日管家巡检报告**:\n\n${result.stdout}`);
        } catch (error: any) {
            console.error(`[Cron Error] ${error}`);
            await sendReply(authorizedChatId, `❌ **每日巡检发生错误**:\n${error.message || error.stderr}`);
        }
    });

    cron.schedule(CRON_SCHEDULES.curator, async () => {
        console.log('[Cron] Execution starting: Curator daily briefing');
        try {
            const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/curator.ts')], { env: vaultEnv });
            if (!result.stdout.includes('未在归档库')) {
                await sendReply(authorizedChatId, result.stdout);
            }
        } catch (error: any) {
            console.error(`[Cron Error Curator] ${error}`);
            await sendReply(authorizedChatId, `❌ **每日策展发生错误**:\n${error.message || error.stderr}`);
        }
    });

    cron.schedule(CRON_SCHEDULES.sessionLog, async () => {
        console.log('[Cron] Execution starting: Session-to-Log');
        try {
            const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/session-to-log.ts')], { env: vaultEnv });
            if (result.stdout && !result.stdout.includes('跳过')) {
                await sendReply(authorizedChatId, result.stdout);
            }
        } catch (error: any) {
            console.error(`[Cron Error Session-to-Log] ${error}`);
            await sendReply(authorizedChatId, `❌ **Session→Log 失败**:\n${error.message || error.stderr}`);
        }
    });

    cron.schedule(CRON_SCHEDULES.weeklyReport, async () => {
        console.log('[Cron] Execution starting: Weekly report');
        try {
            const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/weekly-report.ts')], { env: vaultEnv });
            if (result.stdout && !result.stdout.includes('⚠️')) {
                await sendReply(authorizedChatId, `📊 **本周周报**\n\n${result.stdout}`);
            } else if (result.stdout) {
                await sendReply(authorizedChatId, result.stdout);
            }
        } catch (error: any) {
            console.error(`[Cron Error WeeklyReport] ${error}`);
            await sendReply(authorizedChatId, `❌ **周报生成失败**:\n${error.message || error.stderr}`);
        }
    });

    console.log(`[System] Cron jobs configured (Butler: ${CRON_SCHEDULES.butler}, Curator: ${CRON_SCHEDULES.curator}, Session→Log: ${CRON_SCHEDULES.sessionLog}, WeeklyReport: ${CRON_SCHEDULES.weeklyReport}).`);
}
