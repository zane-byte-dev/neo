import { join } from 'path';
import { promises as fs } from 'fs';
import type { Task } from './types.js';

interface MediaDeps {
    bot: any;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function processPhotoMessage(deps: MediaDeps, ctx: any, isAuthorized: (chatId: number) => boolean) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    const userName = ctx.chat.first_name || 'User';
    const caption: string = ctx.message.caption || '';

    console.log(`[Photo] From ${userName} (ID: ${chatId}, MsgID: ${messageId})${caption ? ': ' + caption : ''}`);

    if (!isAuthorized(chatId)) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    const photos: Array<{ file_id: string; width: number; height: number }> = ctx.message.photo;
    const largest = photos[photos.length - 1];

    const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `photo_${messageId}_${Date.now()}.jpg`);

    try {
        const fileLink = await deps.bot.telegram.getFileLink(largest.file_id);
        const res = await fetch(fileLink.href);
        if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(tmpPath, buffer);
        console.log(`[Photo] Saved to ${tmpPath}`);
    } catch (err: any) {
        console.error(`[Photo Error] ${err.message}`);
        await ctx.reply('⚠️ 图片下载失败，请重试。');
        return;
    }

    const question = caption ? caption : '请分析并详细描述这张图片的内容。';

    const task: Task = { chatId, question, userName, messageId, imagePath: tmpPath, imageMimeType: 'image/jpeg' };
    await deps.messageQueue.enqueue(task, async (t: Task) => {
        try {
            await deps.processTask(t);
        } finally {
            await fs.unlink(tmpPath).catch(() => {});
        }
    });
}
