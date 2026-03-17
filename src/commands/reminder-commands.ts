import type { ReminderManager } from '../lib/reminder-manager.js';
import type { ScheduledTaskManager } from '../lib/scheduled-task-manager.js';

interface ReminderDeps {
    reminderManager: ReminderManager;
    scheduledTaskManager: ScheduledTaskManager;
}

export async function tryHandleReminderCommand(
    command: string,
    text: string,
    ctx: any,
    deps: ReminderDeps,
): Promise<boolean> {
    switch (command) {
        case '/reminders': {
            const all = deps.reminderManager.getAll();
            if (all.length === 0) {
                await ctx.reply('📅 暂无活跃提醒。');
                return true;
            }
            const lines = all.map(r => {
                const fireStr = new Date(r.fireAt).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                return `⏰ \`${r.id}\` [${fireStr}]\n   ${r.content}`;
            });
            await ctx.reply(
                `📅 **活跃提醒 (${lines.length} 条)**\n\n` + lines.join('\n\n'),
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        case '/remindcancel': {
            const remindId = text.split(' ')[1]?.replace(/^#/, '').trim();
            if (!remindId) {
                await ctx.reply('用法: `/remindcancel <提醒ID>`', { parse_mode: 'Markdown' });
                return true;
            }
            const ok = await deps.reminderManager.cancel(remindId);
            if (ok) {
                await ctx.reply(`✅ 提醒 \`#${remindId}\` 已取消。`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`❌ 未找到提醒 \`#${remindId}\`。`, { parse_mode: 'Markdown' });
            }
            return true;
        }

        case '/schedules': {
            const all = deps.scheduledTaskManager.getAll();
            if (all.length === 0) {
                await ctx.reply('🗓 暂无定时任务。\n\n发送如 "每天早上9点告诉我杭州的天气" 来创建一个。');
                return true;
            }
            const lines = all.map(t =>
                `🔁 \`${t.id}\`  \`${t.cronExpr}\`\n   ${t.content}`
            );
            await ctx.reply(
                `🗓 **定时任务列表 (${lines.length} 条)**\n\n` + lines.join('\n\n') +
                '\n\n用 /unschedule <id> 删除',
                { parse_mode: 'Markdown' }
            );
            return true;
        }

        case '/unschedule': {
            const schedId = text.split(' ')[1]?.replace(/^#/, '').trim();
            if (!schedId) {
                await ctx.reply('用法: `/unschedule <任务ID>`', { parse_mode: 'Markdown' });
                return true;
            }
            const removed = await deps.scheduledTaskManager.cancel(schedId);
            if (removed) {
                await ctx.reply(`✅ 定时任务 \`#${schedId}\` 已删除。`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`❌ 未找到定时任务 \`#${schedId}\`。`, { parse_mode: 'Markdown' });
            }
            return true;
        }

        default:
            return false;
    }
}
