import { join } from 'path';
import { promises as fs } from 'fs';
import { geminiGenerate, geminiUploadFile } from '../lib/gemini-client.js';
import type { Task } from './types.js';

interface MediaDeps {
    bot: any;
    messageQueue: any;
    processTask: (task: Task) => Promise<void>;
}

export async function processVoiceMessage(deps: MediaDeps, ctx: any, isAuthorized: (chatId: number) => boolean) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    const userName = ctx.chat.first_name || 'User';

    if (!isAuthorized(chatId)) {
        await ctx.reply('⛔ Unauthorized.');
        return;
    }

    const fileId: string | undefined = ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
    if (!fileId) {
        await ctx.reply('⚠️ 无法获取语音文件。');
        return;
    }

    const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `voice_${messageId}_${Date.now()}.ogg`);

    try {
        const fileLink = await deps.bot.telegram.getFileLink(fileId);
        const res = await fetch(fileLink.href);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        await fs.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
        console.log(`[Voice] Saved to ${tmpPath}`);
    } catch (err: any) {
        console.error(`[Voice Error] ${err.message}`);
        await ctx.reply('⚠️ 语音下载失败，请重试。');
        return;
    }

    const statusMsg = await deps.bot.telegram.sendMessage(chatId, '🎙️ 正在识别语音...', {
        reply_parameters: { message_id: messageId },
    });

    try {
        const transcription = await transcribeVoice(tmpPath);
        console.log(`[Voice] Transcription: ${transcription}`);

        await deps.bot.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `🎙️ 已识别: "${transcription}"\n\n⏳ 思考中...`
        ).catch(() => {});

        const task: Task = { chatId, question: transcription, userName, messageId };
        await deps.messageQueue.enqueue(task, async (t: Task) => {
            try {
                await deps.processTask(t);
            } finally {
                await deps.bot.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            }
        });
    } catch (err: any) {
        console.error(`[Voice Error] Transcription failed: ${err.message}`);
        await deps.bot.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `⚠️ 语音识别失败: ${err.message}`
        ).catch(() => {});
    } finally {
        await fs.unlink(tmpPath).catch(() => {});
    }
}

async function transcribeVoice(filePath: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
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
