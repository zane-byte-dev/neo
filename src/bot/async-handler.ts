import type { PlatformAdapter, NormalizedMessage, TenantKey } from '../types/platform.js';

interface AsyncDeps {
    asyncTaskManager: any;
    geminiClient: any;
    sendReply: (chatId: string, text: string, retries?: number, replyToMessageId?: string) => Promise<void>;
    activeTaskIds: Set<string>;
}

export function setupAsyncPolling(deps: AsyncDeps) {
    const { asyncTaskManager, activeTaskIds, sendReply } = deps;
    asyncTaskManager.startPolling(async (task: any, result: string) => {
        if (activeTaskIds.has(task.id)) return;
        console.log(`[Poller] Task #${task.id} completed. Pushing result to user.`);
        await sendReply(String(task.chatId), `✅ **后台任务 #${task.id} 异步完成:**\n\n${result}`);
    });
}

export async function handleAsyncTask(
    deps: AsyncDeps,
    msg: NormalizedMessage,
) {
    const { tenantKey, chatId, id: messageId, userName } = msg;
    let text = msg.text;

    if (text.startsWith('/research ')) {
        text = text.replace('/research ', '').trim();
    } else if (text.startsWith('/async ')) {
        text = text.replace('/async ', '').trim();
    }

    console.log(`[AsyncDispatcher] Intercepted long-running intent from ${userName}: ${text}`);

    const task = await deps.asyncTaskManager.createTask(chatId, text);

    await deps.sendReply(
        chatId,
        `👌 任务已启动，ID: #${task.id}。\n正在进入独立引擎处理 (如 Deep Research)。\n你可以继续聊天，处理完我会主动推送结果。`,
        2,
        messageId,
    );

    void processAsyncTaskBackground(deps, task, userName);
}

export async function processAsyncTaskBackground(
    deps: AsyncDeps,
    task: any,
    userName: string
) {
    deps.activeTaskIds.add(task.id);
    console.log(`[AsyncWorker] Executing task #${task.id} in background...`);

    try {
        await deps.asyncTaskManager.updateTaskStatus(task.id, 'running');

        const asyncPrompt = `[ASYNC TASK] Please execute the following long-running task. If you need to use tools like research_start or heavy filesystem manipulation, do it now.\n\nTask: ${task.prompt}`;

        const responseText = await deps.geminiClient.chatAsyncWithContext(asyncPrompt);

        if (responseText) {
            await deps.asyncTaskManager.updateTaskStatus(task.id, 'completed', { result: responseText });
            await deps.sendReply(String(task.chatId), `✅ **后台任务 #${task.id} 完成:**\n\n${responseText}`);
        } else {
            await deps.asyncTaskManager.updateTaskStatus(task.id, 'failed', { error: 'Empty response' });
            await deps.sendReply(String(task.chatId), `⚠️ **任务 #${task.id} 似乎没有返回有效结果。`);
        }
    } catch (error: any) {
        console.error(`[AsyncWorker Error] Task #${task.id}:`, error);
        await deps.asyncTaskManager.updateTaskStatus(task.id, 'failed', { error: error.message || String(error) });
        await deps.sendReply(String(task.chatId), `🔥 **后台任务 #${task.id} 执行失败:**\n${error.message}`);
    } finally {
        deps.activeTaskIds.delete(task.id);
    }
}
