import { join } from 'path';
import { promises as fs } from 'fs';
import type { PlatformAdapter, NormalizedMessage } from '../types/platform.js';
import type { Task } from '../core/types.js';

interface UrlDeps {
    adapter: PlatformAdapter;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function handleUrlMessage(
    deps: UrlDeps,
    msg: NormalizedMessage,
    url: string,
) {
    const { tenantKey, chatId, userName, id: messageId, text: rawText } = msg;

    const statusMsg = await deps.adapter.sendMessage(
        chatId,
        `🌐 正在抓取页面...\n${url}`,
        { replyToId: messageId },
    );

    let pageText: string;
    let savedPath: string;

    try {
        ({ text: pageText, savedPath } = await fetchAndSaveUrl(url));
        await deps.adapter.editMessage(
            chatId,
            statusMsg.id,
            `🌐 页面已抓取并保存\n${url}\n\n⏳ 正在分析...`,
        ).catch(() => {});
    } catch (err: any) {
        console.error(`[URL Error] ${err.message}`);
        await deps.adapter.editMessage(
            chatId,
            statusMsg.id,
            `⚠️ 页面抓取失败: ${err.message}`,
        ).catch(() => {});
        return;
    }

    const userQuestion = rawText.replace(url, '').trim();
    const question = userQuestion
        ? `${userQuestion}\n\n[网页内容 - ${url} | 本地文件: ${savedPath}]:\n${pageText}`
        : `请对以下网页内容进行摘要，提炼核心观点和要点。\n\n[网页内容 - ${url} | 本地文件: ${savedPath}]:\n${pageText}`;

    const task: Task = { tenantKey, chatId, question, userName, messageId };
    await deps.messageQueue.enqueue(task, async (t: Task) => {
        try {
            await deps.processTask(t);
        } finally {
            await deps.adapter.deleteMessage(chatId, statusMsg.id).catch(() => {});
        }
    });
}

async function fetchAndSaveUrl(url: string): Promise<{ text: string; savedPath: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let html: string;
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; inkClaw/2.0)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
    } finally {
        clearTimeout(timeout);
    }
    const plainText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const truncated = plainText.length > 20000
        ? plainText.slice(0, 20000) + '\n\n[...内容过长，已截断至前 20000 字符]'
        : plainText;

    const inboxDir = join(
        process.env.WORK_DIR || process.cwd(),
        'history',
        'inbox'
    );
    await fs.mkdir(inboxDir, { recursive: true });

    const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${dateStr}-${domain}.md`;
    const savedPath = join(inboxDir, fileName);

    const fileContent = `# ${url}\n\n> 抓取时间: ${new Date().toLocaleString('zh-CN')}\n\n${truncated}`;
    await fs.writeFile(savedPath, fileContent, 'utf8');
    console.log(`[URL] Saved to ${savedPath}`);

    return { text: truncated, savedPath };
}
