#!/usr/bin/env node

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import PQueue from 'p-queue';
import { execa } from 'execa';
import { join } from 'path';
import { promises as fs } from 'fs';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { markdownToTelegram } from './lib/markdown-converter.js';
import { setupLogger } from './lib/logger.js';
import { AsyncTaskManager } from './lib/async-task-manager.js';
import cron from 'node-cron';


// Initialize Logger
setupLogger();

// Load environment variables
config();

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
    ? parseInt(process.env.TELEGRAM_CHAT_ID, 10)
    : null;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN missing.');
    process.exit(1);
}

if (!AUTHORIZED_CHAT_ID) {
    console.error('❌ TELEGRAM_CHAT_ID missing. Set it to restrict bot access to a specific user.');
    process.exit(1);
}

// Pre-flight: Clean up orphaned gemini processes to avoid pipe blockage
try {
    // Use a temporary direct execa call since geminiClient isn't ready
    await execa('pkill', ['-f', 'gemini --experimental-acp']).catch(() => { });
} catch (e) { }

// Initialize Gemini client
const geminiClient = new GeminiClient();

// Initialize chat history cache
const chatHistoryCache = new ChatHistoryCache();
await chatHistoryCache.init();

// Initialize async task manager
const asyncTaskManager = new AsyncTaskManager(process.env.GEMINI_WORK_DIR || process.cwd());
await asyncTaskManager.init();

// Keywords that trigger background async tasks
const ASYNC_TRIGGER_PREFIXES = ['调研', '重构'];

// Task queue (Producer-Consumer model)
const taskQueue = new PQueue({ concurrency: 1 });

interface Task {
    chatId: number;
    question: string;
    userName: string;
    messageId: number;
}

class NeoAgentBot {
    private bot: Telegraf;
    private activeTaskIds = new Set<string>();

    constructor(token: string) {
        this.bot = new Telegraf(token);
        this.setupHandlers();
        this.setupCronJobs();
        this.setupAsyncPolling();
        console.log('[System] Background worker queue started.');
    }

    /**
     * Setup background polling for long-running tasks
     */
    private setupAsyncPolling() {
        asyncTaskManager.startPolling(async (task, result) => {
            if (this.activeTaskIds.has(task.id)) return; // already being handled by background worker
            console.log(`[Poller] Task #${task.id} completed. Pushing result to user.`);
            await this.sendReply(task.chatId, `✅ **后台任务 #${task.id} 异步完成:**\n\n${result}`);
        });
    }

    /**
     * Setup scheduled cron jobs (delegating to independent refinery scripts)
     */
    private setupCronJobs() {
        if (!AUTHORIZED_CHAT_ID) {
            console.log('[System] No AUTHORIZED_CHAT_ID found. Cron jobs disabled.');
            return;
        }

        const projectRoot = process.env.GEMINI_WORK_DIR || process.cwd();

        // Run every day at 02:00 AM (Butler)
        cron.schedule('0 2 * * *', async () => {
            console.log('[Cron] Execution starting: Butler daily maintenance');
            try {
                const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/butler.ts')]);
                await this.sendReply(AUTHORIZED_CHAT_ID, `📅 **每日管家巡检报告**:\n\n${result.stdout}`);
            } catch (error: any) {
                console.error(`[Cron Error] ${error}`);
                await this.sendReply(AUTHORIZED_CHAT_ID, `❌ **每日巡检发生错误**:\n${error.message || error.stderr}`);
            }
        });

        // Run every day at 09:30 AM (Curator)
        cron.schedule('30 9 * * *', async () => {
            console.log('[Cron] Execution starting: Curator daily briefing');
            try {
                const result = await execa('npx', ['tsx', join(projectRoot, 'apps/refinery/curator.ts')]);
                if (!result.stdout.includes('未在归档库')) {
                    await this.sendReply(AUTHORIZED_CHAT_ID, result.stdout);
                }
            } catch (error: any) {
                console.error(`[Cron Error Curator] ${error}`);
                await this.sendReply(AUTHORIZED_CHAT_ID, `❌ **每日策展发生错误**:\n${error.message || error.stderr}`);
            }
        });

        console.log('[System] Cron jobs configured (Butler: 02:00, Curator: 09:30).');
    }

    /**
     * Setup bot message handlers
     */
    private setupHandlers() {
        // Start command
        this.bot.command('start', (ctx) => {
            this.handleCommand(ctx);
        });

        // Handle all text messages
        this.bot.on(message('text'), async (ctx) => {
            await this.processMessage(ctx);
        });

        // Handle photo messages
        this.bot.on(message('photo'), async (ctx) => {
            await this.processPhotoMessage(ctx);
        });

        // Handle voice / audio messages
        this.bot.on(message('voice'), async (ctx) => {
            await this.processVoiceMessage(ctx);
        });
        this.bot.on(message('audio'), async (ctx) => {
            await this.processVoiceMessage(ctx);
        });

        // Error handling
        this.bot.catch((err, ctx) => {
            console.error(`[Bot Error] ${err}`);
        });
    }

    /**
     * Handle incoming voice / audio messages.
     * Downloads the file, transcribes via Gemini File API, then processes as text.
     */
    private async processVoiceMessage(ctx: any) {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';

        if (!this.isAuthorized(chatId)) {
            await ctx.reply('⛔ Unauthorized.');
            return;
        }

        const fileId: string | undefined =
            ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
        if (!fileId) {
            await ctx.reply('⚠️ 无法获取语音文件。');
            return;
        }

        // Download to tmp dir
        const tmpDir = join(process.env.GEMINI_WORK_DIR || process.cwd(), '.tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, `voice_${messageId}_${Date.now()}.ogg`);

        try {
            const fileLink = await this.bot.telegram.getFileLink(fileId);
            const res = await fetch(fileLink.href);
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            await fs.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
            console.log(`[Voice] Saved to ${tmpPath}`);
        } catch (err: any) {
            console.error(`[Voice Error] ${err.message}`);
            await ctx.reply('⚠️ 语音下载失败，请重试。');
            return;
        }

        // Show interim status
        const statusMsg = await this.bot.telegram.sendMessage(chatId, '🎙️ 正在识别语音...', {
            reply_parameters: { message_id: messageId },
        });

        try {
            const transcription = await this.transcribeVoice(tmpPath);
            console.log(`[Voice] Transcription: ${transcription}`);

            // Update status to show what was heard
            await this.bot.telegram.editMessageText(
                chatId, statusMsg.message_id, undefined,
                `🎙️ 已识别: "${transcription}"\n\n⏳ 思考中...`
            ).catch(() => {});

            const task: Task = { chatId, question: transcription, userName, messageId };
            taskQueue.add(async () => {
                try {
                    await this.processTask(task);
                } finally {
                    await this.bot.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
                }
            });
        } catch (err: any) {
            console.error(`[Voice Error] Transcription failed: ${err.message}`);
            await this.bot.telegram.editMessageText(
                chatId, statusMsg.message_id, undefined,
                `⚠️ 语音识别失败: ${err.message}`
            ).catch(() => {});
        } finally {
            await fs.unlink(tmpPath).catch(() => {});
        }
    }

    /**
     * Transcribe an OGG voice file using Gemini File API + gemini-1.5-flash.
     */
    private async transcribeVoice(filePath: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

        // 1. Upload file to Gemini File API
        const fileBuffer = await fs.readFile(filePath);
        const uploadRes = await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'audio/ogg',
                    'X-Goog-Upload-Command': 'upload, finalize',
                    'X-Goog-Upload-Header-Content-Length': String(fileBuffer.length),
                },
                body: fileBuffer,
            }
        );
        if (!uploadRes.ok) {
            throw new Error(`File upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
        }
        const uploadData = await uploadRes.json() as any;
        const fileUri: string | undefined = uploadData.file?.uri;
        if (!fileUri) throw new Error('No fileUri returned from Gemini upload');

        // 2. Ask Gemini to transcribe
        const transcribeRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { fileData: { mimeType: 'audio/ogg', fileUri } },
                            { text: '请将这段语音转录为文字，只输出转录结果，不要任何额外解释。' },
                        ],
                    }],
                }),
            }
        );
        if (!transcribeRes.ok) {
            throw new Error(`Transcription failed: ${transcribeRes.status} ${await transcribeRes.text()}`);
        }
        const data = await transcribeRes.json() as any;
        const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty transcription result');
        return text.trim();
    }

    /**
     * Handle incoming photo messages
     */
    private async processPhotoMessage(ctx: any) {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';
        const caption: string = ctx.message.caption || '';

        console.log(`[Photo] From ${userName} (ID: ${chatId}, MsgID: ${messageId})${caption ? ': ' + caption : ''}`);

        if (!this.isAuthorized(chatId)) {
            await ctx.reply('⛔ Unauthorized.');
            return;
        }

        // Pick the highest resolution variant
        const photos: Array<{ file_id: string; width: number; height: number }> = ctx.message.photo;
        const largest = photos[photos.length - 1];

        // Download image to a temp file inside the work dir so Gemini CLI can read it
        const tmpDir = join(process.env.GEMINI_WORK_DIR || process.cwd(), '.tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, `photo_${messageId}_${Date.now()}.jpg`);

        try {
            const fileLink = await this.bot.telegram.getFileLink(largest.file_id);
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

        const question = caption
            ? `${caption}\n\n[用户附上了一张图片，文件路径: ${tmpPath}，请结合图片内容回答。]`
            : `[用户发送了一张图片，文件路径: ${tmpPath}，请分析并详细描述这张图片的内容。]`;

        const task: Task = { chatId, question, userName, messageId };
        taskQueue.add(async () => {
            try {
                await this.processTask(task);
            } finally {
                await fs.unlink(tmpPath).catch(() => {});
            }
        });
    }

    /**
     * Check if user is authorized
     */
    private isAuthorized(chatId: number): boolean {
        if (AUTHORIZED_CHAT_ID === null) {
            return false;
        }
        return chatId === AUTHORIZED_CHAT_ID;
    }

    /**
     * Process incoming messages
     */
    private async processMessage(ctx: any) {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';

        // If the user replied to a specific message, prepend that quoted content to the question
        const replyTo = ctx.message.reply_to_message;
        const quotedText: string | null = replyTo?.text ?? replyTo?.caption ?? null;
        const rawText: string = ctx.message.text;
        const text = quotedText
            ? `[引用消息]: ${quotedText}\n\n[我的问题]: ${rawText}`
            : rawText;

        // Log received message
        const preview = rawText.length > 50 ? `${rawText.substring(0, 50)}...` : rawText;
        console.log(`[Message] From ${userName} (ID: ${chatId}, MsgID: ${messageId}${quotedText ? ', replying to msg' : ''}): ${preview}`);

        // Authorization check
        if (!this.isAuthorized(chatId)) {
            await ctx.reply('⛔ Unauthorized.');
            return;
        }

        // Handle commands separately
        if (rawText.startsWith('/')) {
            // Check if it's an async task command
            if (rawText.startsWith('/research') || rawText.startsWith('/async')) {
                await this.handleAsyncTask(ctx);
                return;
            }
            await this.handleCommand(ctx);
            return;
        }

        // Detect implicit long tasks (triggered by keyword prefixes)
        if (ASYNC_TRIGGER_PREFIXES.some(prefix => rawText.startsWith(prefix))) {
            await this.handleAsyncTask(ctx);
            return;
        }

        // Add task to queue for async processing
        const task: Task = { chatId, question: text, userName, messageId };
        taskQueue.add(() => this.processTask(task));
    }

    /**
     * Handle asynchronous long-running tasks
     */
    private async handleAsyncTask(ctx: any) {
        const chatId = ctx.chat.id;
        let text = ctx.message.text as string;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';

        // Strip the command prefix so the AI gets a clean prompt
        if (text.startsWith('/research ')) {
            text = text.replace('/research ', '').trim();
        } else if (text.startsWith('/async ')) {
            text = text.replace('/async ', '').trim();
        }

        console.log(`[AsyncDispatcher] Intercepted long-running intent from ${userName}: ${text}`);

        // 1. Create a task in the local DB
        const task = await asyncTaskManager.createTask(chatId, text);

        // 2. Reply instantly
        await this.sendReply(
            chatId,
            `👌 任务已启动，ID: #${task.id}。\n正在进入独立引擎处理 (如 Deep Research)。\n你可以继续聊天，处理完我会主动推送结果。`,
            2,
            messageId
        );

        // 3. Kick off the GeminiClient in fire-and-forget mode
        this.processAsyncTaskBackground(task, userName);
    }

    /**
     * Launch the async task in the background without blocking the taskQueue
     */
    private async processAsyncTaskBackground(task: import('./lib/async-task-manager.js').AsyncTask, userName: string) {
        this.activeTaskIds.add(task.id);
        console.log(`[AsyncWorker] Executing task #${task.id} in background...`);

        try {
            await asyncTaskManager.updateTaskStatus(task.id, 'running');

            // Async tasks run in a fully isolated ephemeral ACP session — no shared history.
            const asyncPrompt = `[ASYNC TASK] Please execute the following long-running task. If you need to use tools like research_start or heavy filesystem manipulation, do it now.\n\nTask: ${task.prompt}`;

            const responseText = await geminiClient.chatAsyncWithContext(asyncPrompt, '', (msg) => {
                // If it's a ToolCall notification, and we see it's research_start, we detach 
                if (msg.method === 'session/update') {
                    const updateData = msg.params?.update;

                    // Simple text-based heuristic for now. If the agent emits a tool call chunk or text 
                    // that indicates it has fired off the deep research, we detach.
                    if (updateData?.sessionUpdate === 'agent_tool_call') {
                        // Example: Detach if we see any tool call in this async context
                        // return { detach: true, result: '[Async] Tool execution started in background.' };
                    }
                }

                // Allow exactly 120 seconds for the "thoughts" and "tool calls" to finish
                // We'll rely on the AcpClient timeout or standard completion for now unless a specific tool is caught.
                return { detach: false };
            });

            if (responseText) {
                // We got a result (either detached early or completed synchronously)
                await asyncTaskManager.updateTaskStatus(task.id, 'completed', { result: responseText });

                // Active push back to Telegram
                await this.sendReply(task.chatId, `✅ **后台任务 #${task.id} 完成:**\n\n${responseText}`);
            } else {
                await asyncTaskManager.updateTaskStatus(task.id, 'failed', { error: 'Empty response' });
                await this.sendReply(task.chatId, `⚠️ **任务 #${task.id} 似乎没有返回有效结果。`);
            }
        } catch (error: any) {
            console.error(`[AsyncWorker Error] Task #${task.id}:`, error);
            await asyncTaskManager.updateTaskStatus(task.id, 'failed', { error: error.message || String(error) });
            await this.sendReply(task.chatId, `🔥 **后台任务 #${task.id} 执行失败:**\n${error.message}`);
        } finally {
            this.activeTaskIds.delete(task.id);
        }
    }

    /**
     * Worker logic: process queued tasks with streaming progress indicator
     */
    private async processTask(task: Task) {
        const { chatId, question, userName, messageId } = task;

        try {
            console.log(`[Worker] Processing task for ${userName}: ${question.substring(0, 20)}...`);

            await chatHistoryCache.addMessage('user', question, userName);
            const context = chatHistoryCache.getContextForGemini();

            // Send placeholder message immediately — will be edited in-place as progress arrives
            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const extraArgs: any = messageId ? { reply_parameters: { message_id: messageId } } : {};
            const placeholderMsg = await this.bot.telegram.sendMessage(
                chatId, `⏳ NeoAgent (${timestamp})\n\n🤔 思考中...`, extraArgs
            );
            const placeholderMsgId = placeholderMsg.message_id;

            // Streaming state
            let lastEditMs = 0;
            let thoughtAccum = '';
            let lastToolCall = '';
            let hasTextStarted = false;

            const buildStatus = () => {
                if (hasTextStarted) return `⏳ NeoAgent (${timestamp})\n\n✍️ 正在生成回复...`;
                const parts: string[] = [`⏳ NeoAgent (${timestamp})`];
                if (lastToolCall) parts.push(`🔧 调用工具: ${lastToolCall}`);
                const thought = thoughtAccum.trim().replace(/\n+/g, ' ');
                parts.push(thought.length > 100 ? '...' + thought.slice(-100) : (thought || '🤔 思考中...'));
                return parts.join('\n\n');
            };

            const tryEdit = () => {
                const now = Date.now();
                if (now - lastEditMs < 1500) return;
                lastEditMs = now;
                this.bot.telegram.editMessageText(chatId, placeholderMsgId, undefined, buildStatus())
                    .catch(() => { });
            };

            const responseText = await geminiClient.chatWithContextStreaming(question, context, (chunk) => {
                if (chunk.type === 'thought') {
                    thoughtAccum += chunk.text;
                    tryEdit();
                } else if (chunk.type === 'tool_call') {
                    lastToolCall = chunk.toolName;
                    tryEdit();
                } else if (chunk.type === 'text' && !hasTextStarted) {
                    hasTextStarted = true;
                    tryEdit();
                }
            });

            if (!responseText) {
                await this.bot.telegram.editMessageText(chatId, placeholderMsgId, undefined, '⚠️ Failed to generate response.').catch(() => { });
                return;
            }

            await chatHistoryCache.addMessage('assistant', responseText);

            // Replace placeholder with final formatted answer
            const finalTimestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const telegramText = markdownToTelegram(responseText);
            const finalText = `🤖 NeoAgent (${finalTimestamp})\n\n${telegramText}`;
            const chunks = this.splitMessage(finalText, 4000);

            if (chunks.length === 1) {
                await this.bot.telegram.editMessageText(chatId, placeholderMsgId, undefined, finalText)
                    .catch(async () => {
                        // Fallback: if edit fails (e.g. message too old), send new message
                        await this.sendReply(chatId, responseText, 2, messageId);
                    });
            } else {
                // Response too long to fit in one edit — delete placeholder and send chunked
                await this.bot.telegram.deleteMessage(chatId, placeholderMsgId).catch(() => { });
                await this.sendReply(chatId, responseText, 2, messageId);
            }

        } catch (error) {
            console.error(`[Worker Error] ${error}`);
            await this.sendReply(chatId, '🔥 处理请求时出现错误，请稍后重试。', 2, messageId);
        }
    }

    /**
     * Send final reply to user with retry and timeout handling
     */
    private async sendReply(chatId: number, text: string, retries: number = 2, replyToMessageId?: number) {
        const timestamp = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });

        // Convert Markdown to Telegram-friendly format
        const telegramText = markdownToTelegram(text);
        const replyText = `🤖 NeoAgent (${timestamp})\n\n${telegramText}`;

        // Split long messages (Telegram limit is 4096 characters)
        const chunks = this.splitMessage(replyText, 4000);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkPrefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : '';

            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    // Send message with replyParameters if available (Telegraf 4.x style)
                    const extraArgs: any = {};
                    if (replyToMessageId) {
                        extraArgs.reply_parameters = { message_id: replyToMessageId };
                    }
                    await this.bot.telegram.sendMessage(chatId, chunkPrefix + chunk, extraArgs);
                    break; // Success, exit retry loop
                } catch (error) {
                    if (attempt === retries) {
                        console.error(`[SendReply] Failed after ${retries} retries: ${error}`);
                        // Don't throw, just log the error
                    } else {
                        // Wait before retry
                        console.log(`[SendReply] Retry ${attempt + 1}/${retries}...`);
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                }
            }
        }
    }

    /**
     * Split long message into chunks
     */
    private splitMessage(message: string, maxLength: number): string[] {
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

    /**
     * Handle bot commands
     */
    private async handleCommand(ctx: any) {
        const text = ctx.message.text as string;
        const [command] = text.split(' ');

        console.log(`[Command] Received: ${command}`);

        switch (command) {
            case '/start':
                await ctx.reply(
                    '🔭 **NeoAgent Connect Gateway**\n' +
                    '这是一个极简的全能代理网关。发送任何消息，远端的 Gemini CLI 将接管思考过程。\n\n' +
                    '`/clear`  — 清空上下文对话历史\n' +
                    '`/newsession` — 开启新会话\n' +
                    '`/async` 或 `/research` — 提交后台长任务 (不会阻塞后续对话)\n' +
                    '`/stats`  — 查看会话统计数据',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '/clear':
                await chatHistoryCache.clearHistory();
                await ctx.reply('🗑️ Chat history cleared. Starting fresh!');
                break;

            case '/newsession':
                await chatHistoryCache.createNewSession();
                await ctx.reply('📝 New session created!');
                break;

            case '/stats': {
                const stats = chatHistoryCache.getStats();
                await ctx.reply(
                    `📊 **Chat Statistics**\n` +
                    `Total sessions: ${stats.totalSessions}\n` +
                    `Current messages: ${stats.currentMessages}\n` +
                    `Session ID: ${stats.sessionId || 'N/A'}`
                );
                break;
            }

            default:
                await ctx.reply('Unknown command. Try /start for help.');
        }
    }

    /**
     * Start the bot
     */
    run() {
        console.log(`🤖 Bot started. Auth Chat ID: ${AUTHORIZED_CHAT_ID || 'ALL'}`);
        console.log(`🛠  Gemini CLI enabled: ${geminiClient.isEnabled()}`);

        if (AUTHORIZED_CHAT_ID) {
            const timeStr = new Date().toLocaleString('zh-CN');
            this.bot.telegram.sendMessage(
                AUTHORIZED_CHAT_ID,
                `🤖 **NeoAgent Gateway** 已于 ${timeStr} 启动/重启。\n` +
                `✅ 网关已上线\n` +
                `✅ 引擎状态: gemini-3-flash-preview via ACP`,
                { parse_mode: 'Markdown' }
            ).catch(err => console.error('[Startup Message Failed]', err));
        }

        this.bot.launch();

        // Enable graceful stop
        process.once('SIGINT', () => { geminiClient.close(); this.bot.stop('SIGINT'); });
        process.once('SIGTERM', () => { geminiClient.close(); this.bot.stop('SIGTERM'); });
    }
}

// Start the bot
const bot = new NeoAgentBot(BOT_TOKEN);
bot.run();
