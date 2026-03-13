#!/usr/bin/env node

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { execa } from 'execa';
import { join } from 'path';
import { promises as fs } from 'fs';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { markdownToTelegram } from './lib/markdown-converter.js';
import { setupLogger } from './lib/logger.js';
import { AsyncTaskManager } from './lib/async-task-manager.js';
import { MessageQueue } from './lib/message-queue.js';
import { ReminderManager, parseReminderTime } from './lib/reminder-manager.js';
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

// Persistent message queue — survives bot restarts
const CACHE_DIR = process.env.CHAT_CACHE_DIR || './cache';
const messageQueue = new MessageQueue(CACHE_DIR);

// Reminder manager
const reminderManager = new ReminderManager(CACHE_DIR);

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
     * Load persisted queue from disk and replay any interrupted tasks.
     */
    async init() {
        // Init reminder manager
        await reminderManager.init(async (reminder) => {
            console.log(`[Reminder] Firing #${reminder.id}: ${reminder.content}`);
            await this.bot.telegram.sendMessage(
                reminder.chatId,
                `⏰ **提醒:** ${reminder.content}`,
                { parse_mode: 'Markdown' }
            ).catch(err => console.error('[Reminder] Send failed:', err.message));
        });

        // Replay interrupted message queue tasks
        const pending = await messageQueue.init();
        if (pending.length === 0) return;

        console.log(`[MessageQueue] Replaying ${pending.length} interrupted task(s)...`);
        for (const task of pending) {
            messageQueue.schedule(task, (t) => this.processTask(t));
        }

        if (AUTHORIZED_CHAT_ID) {
            this.bot.telegram.sendMessage(
                AUTHORIZED_CHAT_ID,
                `♻️ 检测到 ${pending.length} 条上次未完成的消息，已自动恢复处理。`
            ).catch(() => {});
        }
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

        // Handle document messages (PDF, TXT, MD, DOCX, etc.)
        this.bot.on(message('document'), async (ctx) => {
            await this.processDocumentMessage(ctx);
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
            await messageQueue.enqueue(task, async (t) => {
                try {
                    await this.processTask(t);
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
     * Handle incoming document messages (PDF, TXT, MD, DOCX, code files, etc.)
     * - Plain text files: read directly as text and embed in prompt
     * - PDF / binary: upload to Gemini File API for native understanding
     */
    private async processDocumentMessage(ctx: any) {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';
        const caption: string = ctx.message.caption || '';

        if (!this.isAuthorized(chatId)) {
            await ctx.reply('⛔ Unauthorized.');
            return;
        }

        const doc = ctx.message.document;
        const fileName: string = doc.file_name || 'document';
        const mimeType: string = doc.mime_type || 'application/octet-stream';
        const fileSizeBytes: number = doc.file_size || 0;

        console.log(`[Document] From ${userName}: ${fileName} (${mimeType}, ${fileSizeBytes} bytes)`);

        // Telegram Bot API free tier limit: 20 MB
        if (fileSizeBytes > 20 * 1024 * 1024) {
            await ctx.reply('⚠️ 文件超过 20MB，暂不支持。');
            return;
        }

        const statusMsg = await this.bot.telegram.sendMessage(chatId, `📄 正在处理文件: ${fileName}...`, {
            reply_parameters: { message_id: messageId },
        });

        const tmpDir = join(process.env.GEMINI_WORK_DIR || process.cwd(), '.tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, `doc_${messageId}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

        try {
            const fileLink = await this.bot.telegram.getFileLink(doc.file_id);
            const res = await fetch(fileLink.href);
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            await fs.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
        } catch (err: any) {
            console.error(`[Document Error] Download failed: ${err.message}`);
            await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                `⚠️ 文件下载失败: ${err.message}`).catch(() => {});
            return;
        }

        let question: string;

        // Plain-text types: read directly, no File API needed
        const TEXT_MIME_PREFIXES = ['text/'];
        const TEXT_EXTENSIONS = ['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml',
                                  '.ts', '.js', '.py', '.java', '.go', '.rs', '.sh'];
        const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
        const isPlainText = TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || TEXT_EXTENSIONS.includes(ext);

        try {
            if (isPlainText) {
                const content = await fs.readFile(tmpPath, 'utf8');
                const truncated = content.length > 30000 ? content.slice(0, 30000) + '\n\n[...内容过长，已截断至前 30000 字符]' : content;
                question = caption
                    ? `${caption}\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``
                    : `请分析以下文件内容并给出总结或见解。\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``;
            } else {
                // Binary / PDF: upload via Gemini File API
                const fileUri = await this.uploadToGeminiFileApi(tmpPath, mimeType);
                await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                    `📄 文件已上传，正在分析...`).catch(() => {});
                question = caption
                    ? `${caption}\n\n[用户上传了文件: ${fileName}，fileUri: ${fileUri}，mimeType: ${mimeType}，请结合文件内容回答。]`
                    : `请分析以下文件并给出详细总结。\n\n[文件名: ${fileName}，fileUri: ${fileUri}，mimeType: ${mimeType}]`;
            }
        } catch (err: any) {
            console.error(`[Document Error] Processing failed: ${err.message}`);
            await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                `⚠️ 文件处理失败: ${err.message}`).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
            return;
        }

        const task: Task = { chatId, question, userName, messageId };
        await messageQueue.enqueue(task, async (t) => {
            try {
                await this.processTask(t);
            } finally {
                await this.bot.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
                await fs.unlink(tmpPath).catch(() => {});
            }
        });
    }

    /**
     * Upload a binary file to Gemini File API and return its fileUri.
     */
    private async uploadToGeminiFileApi(filePath: string, mimeType: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

        const fileBuffer = await fs.readFile(filePath);
        const res = await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': mimeType,
                    'X-Goog-Upload-Command': 'upload, finalize',
                    'X-Goog-Upload-Header-Content-Length': String(fileBuffer.length),
                },
                body: fileBuffer,
            }
        );
        if (!res.ok) throw new Error(`File API upload failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as any;
        const uri: string | undefined = data.file?.uri;
        if (!uri) throw new Error('No fileUri returned from Gemini File API');
        return uri;
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
        await messageQueue.enqueue(task, async (t) => {
            try {
                await this.processTask(t);
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

        // Detect reminder intent: "提醒我", "N分钟/小时后"
        const isReminderIntent = rawText.includes('提醒我') ||
            /^\d+\s*(分钟|小时|天)后/.test(rawText);
        if (isReminderIntent) {
            await this.handleReminderMessage(ctx, rawText, chatId, messageId);
            return;
        }

        // Detect URLs — fetch, save and inject content into prompt
        const urlMatch = rawText.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            await this.handleUrlMessage(ctx, urlMatch[0], rawText, userName, chatId, messageId);
            return;
        }

        // Add task to queue for async processing
        const task: Task = { chatId, question: text, userName, messageId };
        await messageQueue.enqueue(task, (t) => this.processTask(t));
    }

    /**
     * Parse and register a natural-language reminder
     */
    private async handleReminderMessage(ctx: any, text: string, chatId: number, messageId: number) {
        const result = parseReminderTime(text);
        if (!result || !result.content) {
            await ctx.reply(
                '⚠️ 无法解析提醒时间，请用以下格式：\n' +
                '• `提醒我 10分钟后 xxx`\n' +
                '• `提醒我 2小时后 xxx`\n' +
                '• `提醒我 明天9点 xxx`\n' +
                '• `提醒我 明天下午3点半 xxx`\n' +
                '• `提醒我 今天22:30 xxx`',
                { parse_mode: 'Markdown', reply_parameters: { message_id: messageId } }
            );
            return;
        }

        const reminder = await reminderManager.add(chatId, result.content, result.fireAt);
        const fireStr = new Date(result.fireAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        await ctx.reply(
            `✅ 提醒已设置！\n\n` +
            `📌 内容: ${result.content}\n` +
            `🕐 时间: ${fireStr}\n` +
            `🆔 ID: \`${reminder.id}\`\n\n` +
            `用 /remindcancel \`${reminder.id}\` 取消`,
            { parse_mode: 'Markdown', reply_parameters: { message_id: messageId } }
        );
    }

    /**
     * Fetch a URL, strip to plain text, save to web-cache, and queue as a normal task.
     */
    private async handleUrlMessage(
        ctx: any,
        url: string,
        rawText: string,
        userName: string,
        chatId: number,
        messageId: number
    ) {
        const statusMsg = await this.bot.telegram.sendMessage(
            chatId, `🌐 正在抓取页面...\n${url}`,
            { reply_parameters: { message_id: messageId } }
        );

        let pageText: string;
        let savedPath: string | null = null;

        try {
            ({ text: pageText, savedPath } = await this.fetchAndSaveUrl(url));
            await this.bot.telegram.editMessageText(
                chatId, statusMsg.message_id, undefined,
                `🌐 页面已抓取并保存\n${url}\n\n⏳ 正在分析...`
            ).catch(() => {});
        } catch (err: any) {
            console.error(`[URL Error] ${err.message}`);
            await this.bot.telegram.editMessageText(
                chatId, statusMsg.message_id, undefined,
                `⚠️ 页面抓取失败: ${err.message}`
            ).catch(() => {});
            return;
        }

        // Build prompt: if user added a question alongside the URL use it, otherwise summarize
        const userQuestion = rawText.replace(url, '').trim();
        const question = userQuestion
            ? `${userQuestion}\n\n[网页内容 - ${url}]:\n${pageText}`
            : `请对以下网页内容进行摘要，提炼核心观点和要点。\n\n[网页内容 - ${url}]:\n${pageText}`;

        const task: Task = { chatId, question, userName, messageId };
        await messageQueue.enqueue(task, async (t) => {
            try {
                await this.processTask(t);
            } finally {
                await this.bot.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            }
        });
    }

    /**
     * Fetch URL content, strip HTML to plain text, save as .md to web-cache/.
     * Returns the plain text and the saved file path.
     */
    private async fetchAndSaveUrl(url: string): Promise<{ text: string; savedPath: string }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        let html: string;
        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NeoAgent/2.0)' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            html = await res.text();
        } finally {
            clearTimeout(timeout);
        }

        // Strip HTML to readable plain text
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

        // Truncate to ~20k chars to stay within context limits
        const truncated = plainText.length > 20000
            ? plainText.slice(0, 20000) + '\n\n[...内容过长，已截断至前 20000 字符]'
            : plainText;

        // Save to web-cache/YYYY-MM-DD/<sanitized-domain>_<timestamp>.md
        const cacheDir = join(
            process.env.GEMINI_WORK_DIR || process.cwd(),
            'web-cache',
            new Date().toISOString().slice(0, 10)
        );
        await fs.mkdir(cacheDir, { recursive: true });

        const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${domain}_${Date.now()}.md`;
        const savedPath = join(cacheDir, fileName);

        const fileContent = `# ${url}\n\n> 抓取时间: ${new Date().toLocaleString('zh-CN')}\n\n${truncated}`;
        await fs.writeFile(savedPath, fileContent, 'utf8');
        console.log(`[URL] Saved to ${savedPath}`);

        return { text: truncated, savedPath };
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

            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const extraArgs: any = messageId ? { reply_parameters: { message_id: messageId } } : {};

            // Send placeholder — will become the first streaming message
            const placeholderMsg = await this.bot.telegram.sendMessage(
                chatId, `⏳ NeoAgent (${timestamp})\n\n🤔 思考中...`, extraArgs
            );

            // ── Streaming state ──────────────────────────────────────────────
            let thoughtAccum = '';
            let lastToolCall = '';
            let textAccum = '';          // accumulated reply text so far
            let hasTextStarted = false;

            // The "active" message being edited live; may be replaced when chunk splits
            let activeMsgId = placeholderMsg.message_id;
            // char count already committed to previous messages (for overflow detection)
            let committedChars = 0;

            let lastEditMs = 0;
            let pendingEdit = false;

            const EDIT_INTERVAL_MS = 1200;  // Telegram rate-limit safe interval
            const CHUNK_LIMIT = 3800;       // leave headroom for header

            const header = () => `🤖 NeoAgent (${timestamp})\n\n`;

            // Fire an editMessageText; silently ignore "message not modified" errors
            const doEdit = (msgId: number, body: string) => {
                const now = Date.now();
                if (now - lastEditMs < EDIT_INTERVAL_MS) {
                    pendingEdit = true;
                    return;
                }
                lastEditMs = now;
                pendingEdit = false;
                this.bot.telegram.editMessageText(chatId, msgId, undefined, body)
                    .catch(() => {});
            };

            const buildThinkingStatus = () => {
                const parts: string[] = [`⏳ NeoAgent (${timestamp})`];
                if (lastToolCall) parts.push(`🔧 调用工具: ${lastToolCall}`);
                const thought = thoughtAccum.trim().replace(/\n+/g, ' ');
                parts.push(thought.length > 120 ? '...' + thought.slice(-120) : (thought || '🤔 思考中...'));
                return parts.join('\n\n');
            };

            // ── Chunk handler ────────────────────────────────────────────────
            const onChunk = async (chunk: import('./lib/gemini-client.js').StreamChunk) => {
                if (chunk.type === 'thought') {
                    thoughtAccum += chunk.text;
                    if (!hasTextStarted) doEdit(activeMsgId, buildThinkingStatus());

                } else if (chunk.type === 'tool_call') {
                    lastToolCall = chunk.toolName;
                    if (!hasTextStarted) doEdit(activeMsgId, buildThinkingStatus());

                } else if (chunk.type === 'text') {
                    hasTextStarted = true;
                    textAccum += chunk.text;

                    // Check if current slice for this message would overflow
                    const slice = textAccum.slice(committedChars);
                    if (slice.length > CHUNK_LIMIT) {
                        // Seal current message at the last newline boundary
                        const cutAt = slice.lastIndexOf('\n', CHUNK_LIMIT) > 0
                            ? slice.lastIndexOf('\n', CHUNK_LIMIT)
                            : CHUNK_LIMIT;
                        const sealed = slice.slice(0, cutAt);
                        await this.bot.telegram.editMessageText(
                            chatId, activeMsgId, undefined, header() + markdownToTelegram(sealed)
                        ).catch(() => {});

                        committedChars += cutAt;
                        // Start a new message for the overflow
                        const newMsg = await this.bot.telegram.sendMessage(
                            chatId, `⏳ NeoAgent (${timestamp})\n\n✍️ 续...`
                        );
                        activeMsgId = newMsg.message_id;
                        lastEditMs = 0;
                    } else {
                        doEdit(activeMsgId, header() + markdownToTelegram(slice));
                    }
                }
            };

            const responseText = await geminiClient.chatWithContextStreaming(question, context, onChunk);

            // ── Final flush ──────────────────────────────────────────────────
            if (!responseText) {
                await this.bot.telegram.editMessageText(chatId, activeMsgId, undefined, '⚠️ Failed to generate response.').catch(() => {});
                return;
            }

            await chatHistoryCache.addMessage('assistant', responseText);

            const finalTimestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const fullFormatted = markdownToTelegram(responseText);
            const finalSlice = fullFormatted.slice(
                markdownToTelegram(responseText.slice(0, committedChars)).length
            );

            // Edit the last active message with whatever remains
            const finalBody = `🤖 NeoAgent (${finalTimestamp})\n\n${finalSlice || fullFormatted}`;
            await this.bot.telegram.editMessageText(chatId, activeMsgId, undefined, finalBody)
                .catch(async () => {
                    await this.sendReply(chatId, responseText, 2, messageId);
                });

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
                    '`/stats`  — 查看会话统计数据\n' +
                    '`/tasks`  — 查看所有后台任务状态\n' +
                    '`/cancel <id>` — 取消某个任务\n' +
                    '`/async` 或 `/research` — 提交后台长任务 (不会阻塞后续对话)',
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

            case '/tasks': {
                const all = asyncTaskManager.getAllTasks();
                if (all.length === 0) {
                    await ctx.reply('📋 暂无任务记录。');
                    break;
                }
                const STATUS_EMOJI: Record<string, string> = {
                    pending: '⏳',
                    running: '🔄',
                    completed: '✅',
                    failed: '❌',
                };
                const lines = all.slice(0, 20).map(t => {
                    const emoji = STATUS_EMOJI[t.status] ?? '❓';
                    const time = new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                    const prompt = t.prompt.length > 40 ? t.prompt.slice(0, 40) + '...' : t.prompt;
                    return `${emoji} \`#${t.id}\` [${time}]\n   ${prompt}`;
                });
                await ctx.reply(
                    `📋 **任务列表** (最近 ${lines.length} 条)\n\n` + lines.join('\n\n'),
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            case '/cancel': {
                const taskId = text.split(' ')[1]?.replace(/^#/, '').trim();
                if (!taskId) {
                    await ctx.reply('用法: `/cancel <任务ID>`', { parse_mode: 'Markdown' });
                    break;
                }
                const cancelled = await asyncTaskManager.cancelTask(taskId);
                if (cancelled) {
                    await ctx.reply(`✅ 任务 \`#${taskId}\` 已取消。`, { parse_mode: 'Markdown' });
                } else {
                    const task = asyncTaskManager.getTask(taskId);
                    if (!task) {
                        await ctx.reply(`❌ 未找到任务 \`#${taskId}\`。`, { parse_mode: 'Markdown' });
                    } else {
                        await ctx.reply(`⚠️ 任务 \`#${taskId}\` 已是 ${task.status} 状态，无法取消。`, { parse_mode: 'Markdown' });
                    }
                }
                break;
            }

            case '/reminders': {
                const all = reminderManager.getAll();
                if (all.length === 0) {
                    await ctx.reply('📅 暂无活跃提醒。');
                    break;
                }
                const lines = all.map(r => {
                    const fireStr = new Date(r.fireAt).toLocaleString('zh-CN', {
                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                    });
                    return `⏰ \`${r.id}\` [${fireStr}]\n   ${r.content}`;
                });
                await ctx.reply(
                    `📅 **活跃提醒 (${lines.length} 条)**\n\n` + lines.join('\n\n'),
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            case '/remindcancel': {
                const remindId = text.split(' ')[1]?.replace(/^#/, '').trim();
                if (!remindId) {
                    await ctx.reply('用法: `/remindcancel <提醒ID>`', { parse_mode: 'Markdown' });
                    break;
                }
                const ok = await reminderManager.cancel(remindId);
                if (ok) {
                    await ctx.reply(`✅ 提醒 \`#${remindId}\` 已取消。`, { parse_mode: 'Markdown' });
                } else {
                    await ctx.reply(`❌ 未找到提醒 \`#${remindId}\`。`, { parse_mode: 'Markdown' });
                }
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

        // Register command menu with Telegram
        this.bot.telegram.setMyCommands([
            { command: 'start',        description: '查看帮助与所有命令' },
            { command: 'clear',        description: '清空当前对话历史' },
            { command: 'newsession',   description: '开启新会话' },
            { command: 'stats',        description: '查看会话统计' },
            { command: 'tasks',        description: '查看所有后台任务状态' },
            { command: 'cancel',       description: '取消某个任务 /cancel <id>' },
            { command: 'reminders',    description: '查看所有提醒' },
            { command: 'remindcancel', description: '取消提醒 /remindcancel <id>' },
            { command: 'research',     description: '提交深度调研任务' },
        ]).then(() => console.log('[System] Bot commands registered.'))
          .catch(err => console.error('[System] Failed to register commands:', err));

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
        process.once('SIGINT', () => { reminderManager.destroy(); geminiClient.close(); this.bot.stop('SIGINT'); });
        process.once('SIGTERM', () => { reminderManager.destroy(); geminiClient.close(); this.bot.stop('SIGTERM'); });
    }
}

// Start the bot
const bot = new NeoAgentBot(BOT_TOKEN);
await bot.init();
bot.run();
