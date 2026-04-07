import type { PlatformAdapter, TenantKey } from '../types/platform.js';
import type { Task } from './types.js';

interface LifecycleDeps {
    adapter: PlatformAdapter;
    tenantKey: TenantKey;
    chatId: string;
    userProfile: any;
    reminderManager: any;
    scheduledTaskManager: any;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function initLifecycle(deps: LifecycleDeps) {
    await deps.userProfile.init();

    await deps.reminderManager.init(async (reminder: any) => {
        console.log(`[Reminder] Firing #${reminder.id} (${reminder.prompt ? 'action' : 'notification'}): ${reminder.content}`);

        if (reminder.prompt) {
            const task: Task = {
                tenantKey: deps.tenantKey,
                chatId: String(reminder.chatId),
                question: reminder.prompt,
                userName: 'reminder',
                messageId: '0',
            };
            const notifyMsg = await deps.adapter.sendMessage(
                String(reminder.chatId),
                `⏰ 定时任务触发：**${reminder.content}**\n\n⏳ 正在执行...`,
                { parseMode: 'markdown' },
            ).catch(() => null);

            if (notifyMsg) task.messageId = notifyMsg.id;
            await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
        } else {
            await deps.adapter.sendMessage(
                String(reminder.chatId),
                `⏰ **提醒:** ${reminder.content}`,
                { parseMode: 'markdown' },
            ).catch((err: any) => console.error('[Reminder] Send failed:', err.message));
        }
    });

    const pending = await deps.messageQueue.init();

    await deps.scheduledTaskManager.init(async (task: any) => {
        console.log(`[ScheduledTask] Executing #${task.id}: ${task.content}`);
        try {
            const notifyMsg = await deps.adapter.sendMessage(
                String(task.chatId),
                `🕐 定时任务：**${task.content}**\n\n⏳ 正在执行...`,
                { parseMode: 'markdown' },
            ).catch(() => null);

            const queueTask: Task = {
                tenantKey: deps.tenantKey,
                chatId: String(task.chatId),
                question: task.prompt,
                userName: 'scheduled-task',
                messageId: notifyMsg?.id ?? '0',
            };
            await deps.messageQueue.enqueue(queueTask, (t: Task) => deps.processTask(t));
        } catch (err: any) {
            console.error(`[ScheduledTask] Failed to enqueue #${task.id}:`, err.message);
            await deps.adapter.sendMessage(
                String(task.chatId),
                `⚠️ 定时任务「${task.content}」执行失败：${err.message}\n任务 ID: \`${task.id}\``,
                { parseMode: 'markdown' },
            ).catch(() => {});
        }
    });

    if (pending.length === 0) return;

    console.log(`[MessageQueue] Replaying ${pending.length} interrupted task(s)...`);
    for (const task of pending) {
        deps.messageQueue.schedule(task, (t: Task) => deps.processTask(t));
    }

    await deps.adapter.sendMessage(
        deps.chatId,
        `♻️ 检测到 ${pending.length} 条上次未完成的消息，已自动恢复处理。`
    ).catch(() => {});
}
