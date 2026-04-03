import { join } from 'path';
import { promises as fs } from 'fs';
import { isAuthorized } from '../config.js';
import type { PlatformAdapter, NormalizedMessage } from '../types/platform.js';
import type { Task } from './types.js';

interface MediaDeps {
    adapter: PlatformAdapter;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function processPhotoMessage(deps: MediaDeps, msg: NormalizedMessage) {
    const { tenantKey, chatId, id: messageId, userName, media } = msg;
    const caption = media?.caption || '';

    console.log(`[Photo] From ${userName} (${tenantKey}, MsgID: ${messageId})${caption ? ': ' + caption : ''}`);

    if (!isAuthorized(tenantKey)) {
        await deps.adapter.sendMessage(chatId, '⛔ Unauthorized.');
        return;
    }

    const fileId = media?.fileId;
    if (!fileId) {
        await deps.adapter.sendMessage(chatId, '⚠️ 无法获取图片。');
        return;
    }

    const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `photo_${messageId}_${Date.now()}.jpg`);

    try {
        await deps.adapter.downloadFile(fileId, tmpPath);
        console.log(`[Photo] Saved to ${tmpPath}`);
    } catch (err: any) {
        console.error(`[Photo Error] ${err.message}`);
        await deps.adapter.sendMessage(chatId, '⚠️ 图片下载失败，请重试。');
        return;
    }

    const question = caption ? caption : '请分析并详细描述这张图片的内容。';

    const task: Task = { tenantKey, chatId, question, userName, messageId, imagePath: tmpPath, imageMimeType: 'image/jpeg' };
    await deps.messageQueue.enqueue(task, async (t: Task) => {
        try {
            await deps.processTask(t);
        } finally {
            await fs.unlink(tmpPath).catch(() => {});
        }
    });
}
