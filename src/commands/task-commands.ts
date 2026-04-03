import type { AsyncTask } from '../lib/async-task-manager.js';
import type { Command } from './_base.js';

export const taskCommand: Command = {
    commands: ['/tasks', '/cancel'],
    handler: async (command, text, msg, deps) => {
    const reply = (t: string, md = false) => deps.adapter.sendMessage(msg.chatId, t, md ? { parseMode: 'markdown' } : undefined);
    switch (command) {
        case '/tasks': {
            const all = deps.asyncTaskManager.getAllTasks();
            if (all.length === 0) {
                await reply('📋 暂无任务记录。');
                return true;
            }
            const STATUS_EMOJI: Record<string, string> = {
                pending: '⏳',
                running: '🔄',
                completed: '✅',
                failed: '❌',
            };
            const lines = all.slice(0, 20).map((t: AsyncTask) => {
                const emoji = STATUS_EMOJI[t.status] ?? '❓';
                const time = new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                const prompt = t.prompt.length > 40 ? t.prompt.slice(0, 40) + '...' : t.prompt;
                return `${emoji} \`#${t.id}\` [${time}]\n   ${prompt}`;
            });
            await reply(
                `📋 **任务列表** (最近 ${lines.length} 条)\n\n` + lines.join('\n\n'),
                true
            );
            return true;
        }

        case '/cancel': {
            const taskId = text.split(' ')[1]?.replace(/^#/, '').trim();
            if (!taskId) {
                await reply('用法: `/cancel <任务ID>`', true);
                return true;
            }
            const cancelled = await deps.asyncTaskManager.cancelTask(taskId);
            if (cancelled) {
                await reply(`✅ 任务 \`#${taskId}\` 已取消。`, true);
            } else {
                const task = deps.asyncTaskManager.getTask(taskId);
                if (!task) {
                    await reply(`❌ 未找到任务 \`#${taskId}\`。`, true);
                } else {
                    await reply(`⚠️ 任务 \`#${taskId}\` 已是 ${task.status} 状态，无法取消。`, true);
                }
            }
            return true;
        }

        default:
            return false;
    }
    },
};
