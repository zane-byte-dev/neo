import { join } from 'path';
import { promises as fs } from 'fs';
import { geminiGenerate, geminiUploadFile } from '../services/gemini-client.js';
import { getTenantContext } from '../services/tool-context.js';
import { isAuthorized, GEMINI_API_KEY } from '../config.js';
import type { PlatformAdapter, NormalizedMessage } from '../types/platform.js';
import type { Task } from '../core/types.js';

interface MediaDeps {
    adapter: PlatformAdapter;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function processVoiceMessage(deps: MediaDeps, msg: NormalizedMessage) {
    const { tenantKey, chatId, id: messageId, userName, media } = msg;

    if (!isAuthorized(tenantKey)) {
        await deps.adapter.sendMessage(chatId, '⛔ Unauthorized.');
        return;
    }

    const fileId = media?.fileId;
    if (!fileId) {
        await deps.adapter.sendMessage(chatId, '⚠️ 无法获取语音文件。');
        return;
    }

    const tmpDir = join(getTenantContext(tenantKey).workDir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `voice_${messageId}_${Date.now()}.ogg`);

    try {
        await deps.adapter.downloadFile(fileId, tmpPath);
        console.log(`[Voice] Saved to ${tmpPath}`);
    } catch (err: any) {
        console.error(`[Voice Error] ${err.message}`);
        await deps.adapter.sendMessage(chatId, '⚠️ 语音下载失败，请重试。');
        return;
    }

    const statusMsg = await deps.adapter.sendMessage(chatId, '🎙️ 正在识别语音...', { replyToId: messageId });

    try {
        const transcription = await transcribeVoice(tmpPath);
        console.log(`[Voice] Transcription: ${transcription}`);

        await deps.adapter.editMessage(chatId, statusMsg.id, `🎙️ 已识别: "${transcription}"\n\n⏳ 思考中...`).catch(() => {});

        const task: Task = { tenantKey, chatId, question: transcription, userName, messageId };
        await deps.messageQueue.enqueue(task, async (t: Task) => {
            try {
                await deps.processTask(t);
            } finally {
                await deps.adapter.deleteMessage(chatId, statusMsg.id).catch(() => {});
            }
        });
    } catch (err: any) {
        console.error(`[Voice Error] Transcription failed: ${err.message}`);
        await deps.adapter.editMessage(chatId, statusMsg.id, `⚠️ 语音识别失败: ${err.message}`).catch(() => {});
    } finally {
        await fs.unlink(tmpPath).catch(() => {});
    }
}

async function transcribeVoice(filePath: string): Promise<string> {
    const apiKey = GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

    const fileBuffer = await fs.readFile(filePath);
    const fileUri = await geminiUploadFile(apiKey, fileBuffer, 'audio/ogg');

    const text = await geminiGenerate(
        apiKey,
        [{
            parts: [
                { fileData: { mimeType: 'audio/ogg', fileUri } },
                { text: '请将这段语音转录为文字，只输出转录结果，不要任何额外解释。' },
            ],
        }],
    );
    if (!text) throw new Error('Empty transcription result');
    return text;
}
