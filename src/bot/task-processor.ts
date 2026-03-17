import { promises as fs } from 'fs';
import { markdownToTelegram } from '../lib/markdown-converter.js';
import type { Task } from './types.js';

interface ProcessTaskDeps {
    bot: any;
    geminiClient: any;
    chatHistoryCache: any;
    userProfile: any;
    sendReply: (chatId: number, text: string, retries?: number, replyToMessageId?: number) => Promise<void>;
}

export async function processTask(deps: ProcessTaskDeps, task: Task) {
    const { bot, geminiClient, chatHistoryCache, userProfile, sendReply } = deps;
    const { chatId, question, userName, messageId } = task;

    const TASK_TIMEOUT_MS = parseInt(process.env.TASK_TIMEOUT_MS || '300000', 10);
    let taskTimedOut = false;
    const taskTimeoutHandle = setTimeout(async () => {
        taskTimedOut = true;
        console.error(`[Worker] Task timed out after ${TASK_TIMEOUT_MS / 1000}s for: ${question.substring(0, 60)}`);
        await bot.telegram.sendMessage(
            chatId,
            `⚠️ 请求处理超时（>${TASK_TIMEOUT_MS / 60000} 分钟），可能是 AI 引擎无响应，请稍后重试。`
        ).catch(() => {});
    }, TASK_TIMEOUT_MS);

    try {
        console.log(`[Worker] Processing task for ${userName}: ${question.substring(0, 20)}...`);

        if (!task.skipHistory) {
            await chatHistoryCache.addMessage('user', question, userName);
        }
        const historyContext = chatHistoryCache.getContextForGemini();

        const profileCtx = await userProfile.toContextString();
        const context = profileCtx
            ? `${profileCtx}\n\n${historyContext}`
            : historyContext;

        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const extraArgs: any = messageId ? { reply_parameters: { message_id: messageId } } : {};
        const agentLabel = task.skipHistory ? 'btw' : 'inkClaw';

        const placeholderMsg = await bot.telegram.sendMessage(
            chatId,
            `⏳ ${agentLabel} (${timestamp})\n\n🤔 思考中...`,
            extraArgs
        );

        let thoughtAccum = '';
        let lastToolCall = '';
        let textAccum = '';
        let hasTextStarted = false;

        let activeMsgId = placeholderMsg.message_id;
        let committedChars = 0;

        let lastEditMs = 0;

        const EDIT_INTERVAL_MS = 1200;
        const CHUNK_LIMIT = 3800;

        const header = () => `${task.skipHistory ? '💬' : '🤖'} ${agentLabel} (${timestamp})\n\n`;

        const doEdit = (msgId: number, body: string, asHtml: boolean = false) => {
            const now = Date.now();
            if (now - lastEditMs < EDIT_INTERVAL_MS) {
                return;
            }
            lastEditMs = now;
            bot.telegram.editMessageText(
                chatId,
                msgId,
                undefined,
                body,
                asHtml ? { parse_mode: 'HTML' } : undefined
            ).catch(() => {});
        };

        const buildThinkingStatus = () => {
            const parts: string[] = [`⏳ inkClaw (${timestamp})`];
            if (lastToolCall) parts.push(`🔧 调用工具: ${lastToolCall}`);
            const thought = thoughtAccum.trim().replace(/\n+/g, ' ');
            parts.push(thought.length > 120 ? '...' + thought.slice(-120) : (thought || '🤔 思考中...'));
            return parts.join('\n\n');
        };

        const onChunk = async (chunk: any) => {
            if (chunk.type === 'thought') {
                thoughtAccum += chunk.text;
                if (!hasTextStarted) doEdit(activeMsgId, buildThinkingStatus());

            } else if (chunk.type === 'tool_call') {
                lastToolCall = chunk.toolName;
                if (!hasTextStarted) doEdit(activeMsgId, buildThinkingStatus());

            } else if (chunk.type === 'text') {
                hasTextStarted = true;
                textAccum += chunk.text;

                const slice = textAccum.slice(committedChars);
                if (slice.length > CHUNK_LIMIT) {
                    const cutAt = slice.lastIndexOf('\n', CHUNK_LIMIT) > 0
                        ? slice.lastIndexOf('\n', CHUNK_LIMIT)
                        : CHUNK_LIMIT;
                    const sealed = slice.slice(0, cutAt);
                    await bot.telegram.editMessageText(
                        chatId,
                        activeMsgId,
                        undefined,
                        header() + markdownToTelegram(sealed),
                        { parse_mode: 'HTML' }
                    ).catch(() => {});

                    committedChars += cutAt;
                    const newMsg = await bot.telegram.sendMessage(
                        chatId,
                        `⏳ inkClaw (${timestamp})\n\n✍️ 续...`
                    );
                    activeMsgId = newMsg.message_id;
                    lastEditMs = 0;
                } else {
                    doEdit(activeMsgId, header() + markdownToTelegram(slice), true);
                }
            }
        };

        const responseText = task.imagePath && task.imageMimeType
            ? await (async () => {
                const imageData = await fs.readFile(task.imagePath!);
                const imageInput = {
                    type: 'inline',
                    mimeType: task.imageMimeType!,
                    data: imageData.toString('base64'),
                };
                return geminiClient.chatWithContextStreamingWithImage(question, context, imageInput, onChunk);
            })()
            : task.fileUri && task.fileMimeType
            ? await geminiClient.chatWithContextStreamingWithFile(
                question,
                context,
                { type: 'fileUri', mimeType: task.fileMimeType, fileUri: task.fileUri },
                onChunk
            )
            : await geminiClient.chatWithContextStreaming(question, context, onChunk);

        if (!responseText) {
            console.error(`[Worker] No response text for task from ${userName}: "${question.slice(0, 80).replace(/\n/g, ' ')}"`);
            await bot.telegram.editMessageText(chatId, activeMsgId, undefined, '⚠️ Failed to generate response.').catch(() => {});
            return;
        }

        if (!task.skipHistory) {
            await chatHistoryCache.addMessage('assistant', responseText);
        }

        const finalTimestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const fullFormatted = markdownToTelegram(responseText);
        const finalSlice = fullFormatted.slice(
            markdownToTelegram(responseText.slice(0, committedChars)).length
        );

        const finalBody = `🤖 inkClaw (${finalTimestamp})\n\n${finalSlice || fullFormatted}`;
        await bot.telegram.editMessageText(
            chatId,
            activeMsgId,
            undefined,
            finalBody,
            { parse_mode: 'HTML' }
        )
            .catch(async (err: any) => {
                const desc: string = err?.description ?? err?.message ?? '';
                if (desc.includes('message is not modified')) return;
                await sendReply(chatId, responseText, 2, messageId);
            });

    } catch (error) {
        if (!taskTimedOut) {
            console.error(`[Worker Error] ${error}`);
            await sendReply(chatId, '🔥 处理请求时出现错误，请稍后重试。', 2, messageId);
        }
    } finally {
        clearTimeout(taskTimeoutHandle);
    }
}
