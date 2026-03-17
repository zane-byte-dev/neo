import type { Task } from './types.js';

interface LifecycleDeps {
    bot: any;
    userProfile: any;
    reminderManager: any;
    scheduledTaskManager: any;
    messageQueue: any;
    authorizedChatId: number | null;
    processTask: (task: Task) => Promise<void>;
}

export async function initLifecycle(deps: LifecycleDeps) {
    await deps.userProfile.init();

    await deps.reminderManager.init(async (reminder: any) => {
        console.log(`[Reminder] Firing #${reminder.id} (${reminder.prompt ? 'action' : 'notification'}): ${reminder.content}`);

        if (reminder.prompt) {
            const task: Task = {
                chatId: reminder.chatId,
                question: reminder.prompt,
                userName: 'reminder',
                messageId: 0,
            };
            const notifyMsg = await deps.bot.telegram.sendMessage(
                reminder.chatId,
                `⏰ 定时任务触发：**${reminder.content}**\n\n⏳ 正在执行...`,
                { parse_mode: 'Markdown' }
            ).catch(() => null);

            if (notifyMsg) task.messageId = notifyMsg.message_id;
            await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
        } else {
            await deps.bot.telegram.sendMessage(
                reminder.chatId,
                `⏰ **提醒:** ${reminder.content}`,
                { parse_mode: 'Markdown' }
            ).catch((err: any) => console.error('[Reminder] Send failed:', err.message));
        }
    });

    const pending = await deps.messageQueue.init();

    await deps.scheduledTaskManager.init(async (task: any) => {
        console.log(`[ScheduledTask] Executing #${task.id}: ${task.content}`);
        try {
            const notifyMsg = await deps.bot.telegram.sendMessage(
                task.chatId,
                `🕐 定时任务：**${task.content}**\n\n⏳ 正在执行...`,
                { parse_mode: 'Markdown' }
            ).catch(() => null);

            const queueTask: Task = {
                chatId: task.chatId,
                question: task.prompt,
                userName: 'scheduled-task',
                messageId: notifyMsg?.message_id ?? 0,
            };
            await deps.messageQueue.enqueue(queueTask, (t: Task) => deps.processTask(t));
        } catch (err: any) {
            console.error(`[ScheduledTask] Failed to enqueue #${task.id}:`, err.message);
            await deps.bot.telegram.sendMessage(
                task.chatId,
                `⚠️ 定时任务「${task.content}」执行失败：${err.message}\n任务 ID: \`${task.id}\``,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
    });

    if (pending.length === 0) return;

    console.log(`[MessageQueue] Replaying ${pending.length} interrupted task(s)...`);
    for (const task of pending) {
        deps.messageQueue.schedule(task, (t: Task) => deps.processTask(t));
    }

    if (deps.authorizedChatId) {
        deps.bot.telegram.sendMessage(
            deps.authorizedChatId,
            `♻️ 检测到 ${pending.length} 条上次未完成的消息，已自动恢复处理。`
        ).catch(() => {});
    }
}
