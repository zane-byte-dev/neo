import type { Command } from './_base.js';

export const reminderCommand: Command = {
    commands: ['/reminders', '/remindcancel', '/schedules', '/unschedule', '/todos'],
    handler: async (command, text, msg, deps) => {
    const reply = (t: string, md = false) => deps.adapter.sendMessage(msg.chatId, t, md ? { parseMode: 'markdown' } : undefined);
    switch (command) {
        case '/reminders': {
            const all = deps.todoManager.getReminders();
            if (all.length === 0) {
                await reply('📅 暂无活跃提醒。');
                return true;
            }
            const lines = all.map((r: any) => {
                const fireStr = new Date(r.fireAt).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                return `⏰ \`${r.id}\` [${fireStr}]\n   ${r.content}`;
            });
            await reply(
                `📅 **活跃提醒 (${lines.length} 条)**\n\n` + lines.join('\n\n'),
                true
            );
            return true;
        }

        case '/remindcancel': {
            const remindId = text.split(' ')[1]?.replace(/^#/, '').trim();
            if (!remindId) {
                await reply('用法: `/remindcancel <提醒ID>`', true);
                return true;
            }
            const ok = deps.todoManager.delete(remindId);
            if (ok) {
                await reply(`✅ 提醒 \`#${remindId}\` 已取消。`, true);
            } else {
                await reply(`❌ 未找到提醒 \`#${remindId}\`。`, true);
            }
            return true;
        }

        case '/schedules': {
            const all = deps.todoManager.getSchedules();
            if (all.length === 0) {
                await reply('🗓 暂无定时任务。\n\n发送如 "每天早上9点告诉我杭州的天气" 来创建一个。');
                return true;
            }
            const lines = all.map((t: any) =>
                `🔁 \`${t.id}\`  \`${t.cronExpr}\`\n   ${t.content}`
            );
            await reply(
                `🗓 **定时任务列表 (${lines.length} 条)**\n\n` + lines.join('\n\n') +
                '\n\n用 /unschedule <id> 删除',
                true
            );
            return true;
        }

        case '/unschedule': {
            const schedId = text.split(' ')[1]?.replace(/^#/, '').trim();
            if (!schedId) {
                await reply('用法: `/unschedule <任务ID>`', true);
                return true;
            }
            const removed = deps.todoManager.delete(schedId);
            if (removed) {
                await reply(`✅ 定时任务 \`#${schedId}\` 已删除。`, true);
            } else {
                await reply(`❌ 未找到定时任务 \`#${schedId}\`。`, true);
            }
            return true;
        }

        case '/todos': {
            const all = deps.todoManager.getTodos();
            if (all.length === 0) {
                await reply('📋 暂无待办事项。');
                return true;
            }
            const icons: Record<string, string> = { pending: '⬜', in_progress: '🔄', done: '✅', blocked: '🚫' };
            const lines = all.map((t: any) => {
                const icon = icons[t.status] ?? '?';
                return `${icon} \`${t.id}\` ${t.content}`;
            });
            await reply(
                `📋 **待办事项 (${lines.length} 条)**\n\n` + lines.join('\n'),
                true
            );
            return true;
        }

        default:
            return false;
    }
    },
};
