import { markdownToTelegram } from '../lib/markdown-converter.js';

function splitMessage(message: string, maxLength: number): string[] {
    if (message.length <= maxLength) {
        return [message];
    }

    const chunks: string[] = [];
    let currentChunk = '';
    const lines = message.split('\n');

    for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }

            if (line.length > maxLength) {
                for (let i = 0; i < line.length; i += maxLength) {
                    chunks.push(line.substring(i, i + maxLength));
                }
            } else {
                currentChunk = line + '\n';
            }
        } else {
            currentChunk += line + '\n';
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

export async function sendReply(
    bot: any,
    chatId: number,
    text: string,
    retries: number = 2,
    replyToMessageId?: number
) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
    });

    // Split on raw text first, then convert each chunk to HTML so we don't cut HTML tags in half.
    const textChunks = splitMessage(text, 3500);

    for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const chunkPrefix = textChunks.length > 1 ? `[${i + 1}/${textChunks.length}]\n` : '';
        const telegramText = markdownToTelegram(chunk);
        const replyText = `🤖 inkClaw (${timestamp})\n\n${telegramText}`;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const extraArgs: any = {};
                if (replyToMessageId) {
                    extraArgs.reply_parameters = { message_id: replyToMessageId };
                }
                await bot.telegram.sendMessage(
                    chatId,
                    chunkPrefix + replyText,
                    { ...extraArgs, parse_mode: 'HTML' }
                );
                break;
            } catch (error: any) {
                const desc = error?.description || error?.message || '';
                if (desc.includes("can't parse entities") || desc.includes('parse entities')) {
                    try {
                        const fallbackArgs: any = {};
                        if (replyToMessageId) {
                            fallbackArgs.reply_parameters = { message_id: replyToMessageId };
                        }
                        await bot.telegram.sendMessage(chatId, chunkPrefix + chunk, fallbackArgs);
                        break;
                    } catch {
                        // continue retry loop below
                    }
                }

                if (attempt === retries) {
                    console.error(`[SendReply] Failed after ${retries} retries: ${error}`);
                } else {
                    console.log(`[SendReply] Retry ${attempt + 1}/${retries}...`);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
        }
    }
}
