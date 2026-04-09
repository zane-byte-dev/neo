import type { NormalizedMessage } from '../types/platform.js';
import type { Task } from '../core/types.js';

interface UrlDeps {
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function handleUrlMessage(
    deps: UrlDeps,
    msg: NormalizedMessage,
    url: string,
) {
    const { tenantKey, chatId, userName, id: messageId, text: rawText } = msg;

    const userQuestion = rawText.replace(url, '').trim();
    const question = userQuestion
        ? `${userQuestion}\n\n用户分享了链接: ${url}\n请先用 fetch_url 抓取内容，然后回答用户的问题。如果 fetch_url 失败，改用 browser_fetch 重试。`
        : `用户分享了链接: ${url}\n请用 fetch_url 抓取内容，对其进行摘要并提炼核心观点。如果 fetch_url 失败，改用 browser_fetch 重试。如果内容有价值，用 notebook 工具保存。`;

    const task: Task = { tenantKey, chatId, question, userName, messageId };
    await deps.messageQueue.enqueue(task, (t: Task) => deps.processTask(t));
}
