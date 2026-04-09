import { promises as fs } from 'fs';
import { TASK_TIMEOUT_MS, EDIT_INTERVAL_MS, CHUNK_LIMIT } from '../config.js';
import { registerAbort, unregisterAbort } from '../services/task-abort.js';
import { getTenantContext } from '../services/tool-context.js';
import type { ToolContext } from '../utils/gemini-types.js';
import type { PlatformAdapter } from '../types/platform.js';
import type { Task } from './types.js';

interface ProcessTaskDeps {
    adapter: PlatformAdapter;
    geminiClient: any;
    chatHistoryCache: any;
    userProfile: any;
    sendReply: (chatId: string, text: string, retries?: number, replyToMessageId?: string) => Promise<void>;
}

export async function processTask(deps: ProcessTaskDeps, task: Task) {
    const { adapter, geminiClient, chatHistoryCache, userProfile, sendReply } = deps;
    const { chatId, question, userName, messageId } = task;

    // Build ToolContext from the tenant registry for explicit parameter threading
    const tenantCtx = getTenantContext(task.tenantKey);
    const toolContext: ToolContext = {
        tenantKey: task.tenantKey,
        chatId,
        workDir: tenantCtx.workDir,
        systemInstruction: tenantCtx.systemInstruction,
        adapter: tenantCtx.adapter,
        reminderManager: tenantCtx.reminderManager,
        scheduledTaskManager: tenantCtx.scheduledTaskManager,
    };

    const abortController = new AbortController();
    registerAbort(chatId, abortController);
    const { signal } = abortController;

    const taskTimeoutMs = TASK_TIMEOUT_MS;
    let taskTimedOut = false;
    const taskTimeoutHandle = setTimeout(async () => {
        taskTimedOut = true;
        console.error(`[Worker] Task timed out after ${taskTimeoutMs / 1000}s for: ${question.substring(0, 60)}`);
        await adapter.sendMessage(
            chatId,
            `⚠️ 请求处理超时（>${taskTimeoutMs / 60000} 分钟），可能是 AI 引擎无响应，请稍后重试。`
        ).catch(() => {});
    }, taskTimeoutMs);

    // Tracks the most recent bot message id — accessible in the catch block.
    let activeMsgId = '';

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
        const agentLabel = task.skipHistory ? 'btw' : 'inkClaw';

        const placeholderMsg = await adapter.sendMessage(
            chatId,
            `⏳ ${agentLabel} (${timestamp})\n\n🤔 思考中...`,
            { replyToId: messageId || undefined },
        );

        let thoughtAccum = '';
        let lastToolCall = '';
        let textAccum = '';
        let hasTextStarted = false;

        activeMsgId = placeholderMsg.id;
        let committedChars = 0;

        let lastEditMs = 0;

        const header = () => `${task.skipHistory ? '💬' : '🤖'} ${agentLabel} (${timestamp})\n\n`;

        const doEdit = (msgId: string, body: string, asHtml: boolean = false) => {
            const now = Date.now();
            if (now - lastEditMs < EDIT_INTERVAL_MS) {
                return;
            }
            lastEditMs = now;
            adapter.editMessage(chatId, msgId, body, asHtml ? { parseMode: 'html' } : undefined).catch(() => {});
        };

        const buildThinkingStatus = () => {
            const parts: string[] = [`⏳ inkClaw (${timestamp})`];
            if (lastToolCall) parts.push(`🔧 ${lastToolCall}`);
            const thought = thoughtAccum.trim();
            if (thought) {
                // Show the last ~400 chars; if truncated, prefix with "..."
                const snippet = thought.length > 400
                    ? '...' + thought.slice(-400)
                    : thought;
                parts.push(`💭 ${snippet}`);
            } else {
                parts.push('🤔 思考中...');
            }
            return parts.join('\n\n');
        };

        const onChunk = async (chunk: any) => {
            if (chunk.type === 'thought') {
                thoughtAccum += chunk.text;
                if (!hasTextStarted) doEdit(activeMsgId, buildThinkingStatus());

            } else if (chunk.type === 'tool_call') {
                const argsStr = chunk.args && Object.keys(chunk.args).length > 0
                    ? '(' + Object.entries(chunk.args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') + ')'
                    : '';
                lastToolCall = `${chunk.toolName}${argsStr}`;
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
                    await adapter.editMessage(
                        chatId,
                        activeMsgId,
                        header() + adapter.formatMarkdown(sealed),
                        { parseMode: 'html' },
                    ).catch(() => {});

                    committedChars += cutAt;
                    const newMsg = await adapter.sendMessage(
                        chatId,
                        `⏳ inkClaw (${timestamp})\n\n✍️ 续...`
                    );
                    activeMsgId = newMsg.id;
                    lastEditMs = 0;
                } else {
                    doEdit(activeMsgId, header() + adapter.formatMarkdown(slice), true);
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
                return geminiClient.chatWithContextStreamingWithImage(question, context, imageInput, onChunk, signal, toolContext);
            })()
            : task.fileUri && task.fileMimeType
            ? await geminiClient.chatWithContextStreamingWithFile(
                question,
                context,
                { type: 'fileUri', mimeType: task.fileMimeType, fileUri: task.fileUri },
                onChunk,
                signal,
                toolContext,
            )
            : await geminiClient.chatWithContextStreaming(question, context, onChunk, signal, toolContext);

        if (!responseText) {
            console.error(`[Worker] No response text for task from ${userName}: "${question.slice(0, 80).replace(/\n/g, ' ')}"`);
            await adapter.editMessage(chatId, activeMsgId, '⚠️ Failed to generate response.').catch(() => {});
            return;
        }

        if (!task.skipHistory) {
            await chatHistoryCache.addMessage('assistant', responseText);
        }

        const finalTimestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const fullFormatted = adapter.formatMarkdown(responseText);
        const finalSlice = fullFormatted.slice(
            adapter.formatMarkdown(responseText.slice(0, committedChars)).length
        );

        const finalBody = `🤖 inkClaw (${finalTimestamp})\n\n${finalSlice || fullFormatted}`;
        await adapter.editMessage(chatId, activeMsgId, finalBody, { parseMode: 'html' })
            .catch(async (err: any) => {
                const desc: string = err?.description ?? err?.message ?? '';
                if (desc.includes('message is not modified')) return;
                await sendReply(chatId, responseText, 2, messageId);
            });

        // Send thinking content as a separate collapsed message
        if (thoughtAccum.trim()) {
            const thought = thoughtAccum.trim();
            const maxLen = 3500;
            const truncated = thought.length > maxLen
                ? thought.slice(0, maxLen) + '\n\n[...已截断]'
                : thought;
            const escaped = truncated
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            await adapter.sendMessage(
                chatId,
                `<blockquote expandable>💭 Thinking\n\n${escaped}</blockquote>`,
                { parseMode: 'html' },
            ).catch(() => {});
        }

    } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (isAbort) {
            await adapter.editMessage(chatId, activeMsgId, '⏹️ 已中断。').catch(() => {});
            return;
        }
        if (!taskTimedOut) {
            console.error(`[Worker Error] ${error}`);
            await sendReply(chatId, '🔥 处理请求时出现错误，请稍后重试。', 2, messageId);
        }
    } finally {
        unregisterAbort(chatId);
        clearTimeout(taskTimeoutHandle);
    }
}
