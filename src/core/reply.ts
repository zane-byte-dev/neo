import type { PlatformAdapter } from '../types/platform.js';

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
    adapter: PlatformAdapter,
    chatId: string,
    text: string,
    retries: number = 2,
    replyToMessageId?: string
) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
    });

    // Split on raw text first, then convert each chunk so we don't cut tags in half.
    const textChunks = splitMessage(text, 3500);

    for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const chunkPrefix = textChunks.length > 1 ? `[${i + 1}/${textChunks.length}]\n` : '';
        const formatted = adapter.formatMarkdown(chunk);
        const replyText = `🤖 inkClaw (${timestamp})\n\n${formatted}`;

        const isLastChunk = i === textChunks.length - 1;
        const saveButton = isLastChunk
            ? [[{ text: '💾 保存到 Library', callbackData: 'save_lib' }]]
            : undefined;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                await adapter.sendMessage(chatId, chunkPrefix + replyText, {
                    replyToId: replyToMessageId,
                    parseMode: 'html',
                    inlineKeyboard: saveButton,
                });
                break;
            } catch (error: any) {
                const desc = error?.description || error?.message || '';
                if (desc.includes("can't parse entities") || desc.includes('parse entities')) {
                    try {
                        await adapter.sendMessage(chatId, chunkPrefix + chunk, {
                            replyToId: replyToMessageId,
                            inlineKeyboard: saveButton,
                        });
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
