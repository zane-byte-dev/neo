#!/usr/bin/env node

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { execa } from 'execa';
import { join } from 'path';
import { promises as fs } from 'fs';
import { GeminiClient, geminiGenerate, geminiUploadFile } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { markdownToTelegram } from './lib/markdown-converter.js';
import { setupLogger } from './lib/logger.js';
import { AsyncTaskManager } from './lib/async-task-manager.js';
import { MessageQueue } from './lib/message-queue.js';
import { ReminderManager, parseReminderTime } from './lib/reminder-manager.js';
import { ScheduledTaskManager, parseScheduledTask } from './lib/scheduled-task-manager.js';
import { UserProfileManager } from './lib/user-profile.js';
import { setupSkills } from './lib/skills.js';
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

// Register pluggable skills (fetch_url, search_web, get_weather, http_request, get_datetime)
setupSkills();

// Initialize Gemini client
const geminiClient = new GeminiClient();

// Initialize chat history cache
const chatHistoryCache = new ChatHistoryCache();
await chatHistoryCache.init();

// Initialize async task manager
const asyncTaskManager = new AsyncTaskManager(process.env.WORK_DIR || process.cwd());
await asyncTaskManager.init();

// Keywords that trigger background async tasks
const ASYNC_TRIGGER_PREFIXES = ['调研', '重构'];

// Persistent message queue — survives bot restarts
const CACHE_DIR = process.env.CHAT_CACHE_DIR || './cache';
const messageQueue = new MessageQueue(CACHE_DIR);

// Reminder manager
const reminderManager = new ReminderManager(CACHE_DIR);

// Scheduled (recurring) task manager
const scheduledTaskManager = new ScheduledTaskManager(CACHE_DIR);

// User profile
const userProfile = new UserProfileManager(CACHE_DIR);

interface Task {
    chatId: number;
    question: string;
    userName: string;
    messageId: number;
    /** Local path to a downloaded image — read as base64 inline in processTask. */
    imagePath?: string;
    imageMimeType?: string;
    /** Gemini File API URI for already-uploaded binary files (PDF, audio, video). */
    fileUri?: string;
    fileMimeType?: string;
    /** If true, this task is a /btw one-off — not saved to chat history. */
    skipHistory?: boolean;
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
        // Init user profile
        await userProfile.init();

        // Archive expired Telegram sessions to history/memory/ via Gemini compression
        const workDir = process.env.WORK_DIR;
        const archiveApiKey = process.env.GEMINI_API_KEY;
        if (workDir && archiveApiKey) {
            chatHistoryCache.setOnSessionExpire(async (session) => {
                if (session.messages.length < 2) return; // skip trivial sessions

                try {
                    const memoryDir = join(workDir, 'history', 'memory');
                    await fs.mkdir(memoryDir, { recursive: true });

                    const dateStr = new Date(session.startTime).toISOString().slice(0, 10);
                    const memoryFile = join(memoryDir, `${dateStr}.md`);

                    // Idempotency check
                    let existing = '';
                    try { existing = await fs.readFile(memoryFile, 'utf8'); } catch { /* new file */ }
                    if (existing.includes(session.sessionId)) {
                        console.log(`[MemoryArchive] Session ${session.sessionId} already archived, skipping.`);
                        return;
                    }

                    // Build raw transcript for compression (capped to avoid huge prompts)
                    const transcript = session.messages.map(m => {
                        const role = m.role === 'user' ? (m.userName ?? 'User') : 'Neo';
                        const body = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
                        return `${role}: ${body}`;
                    }).join('\n\n');

                    const startHm = new Date(session.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

                    // Call Gemini API directly (not ACP) to compress — lightweight, non-blocking
                    const compressionPrompt = `你是一个个人知识管理助手，负责将对话压缩为记忆摘要。

以下是一段 Telegram 对话记录（开始时间 ${startHm}）：

${transcript}

请将这段对话压缩为 3-5 行的记忆摘要，格式如下（严格遵守）：
## ${startHm} <主题关键词>
- 做了什么（行动 + 结果，一行）
- 产出了哪些文件或结论（若有）
- 遗留了哪些待办项（若有）

规则：
- 只记录事实，不带修饰，不写废话
- 如果只是闲聊或简单问答，第一行写"闲聊/问答"，只保留 1-2 行关键点
- 不要加 session_id 或时间戳，我会自动添加`;

                    const summaryText = await geminiGenerate(
                        archiveApiKey,
                        [{ parts: [{ text: compressionPrompt }] }],
                        { generationConfig: { temperature: 0.2, maxOutputTokens: 300 } },
                    );

                    let summary: string;
                    if (summaryText) {
                        summary = summaryText;
                    } else {
                        // Fallback: simple first-message excerpt if API fails
                        const firstUser = session.messages.find(m => m.role === 'user');
                        const preview = firstUser?.content.slice(0, 100) ?? '（无内容）';
                        summary = `## ${startHm} Telegram 对话\n- ${preview}`;
                    }

                    const block = `\n${summary}\n<!-- session: ${session.sessionId} -->\n`;
                    await fs.appendFile(memoryFile, block, 'utf8');
                    console.log(`[MemoryArchive] Compressed & archived session ${session.sessionId} → ${memoryFile}`);
                } catch (err: any) {
                    console.error('[MemoryArchive] Failed:', err.message);
                }
            });
        }

        // Init reminder manager
        await reminderManager.init(async (reminder) => {
            console.log(`[Reminder] Firing #${reminder.id} (${reminder.prompt ? 'action' : 'notification'}): ${reminder.content}`);

            if (reminder.prompt) {
                // Action reminder: enqueue as a real task so it goes through processTask (streaming)
                const task: Task = {
                    chatId: reminder.chatId,
                    question: reminder.prompt,
                    userName: 'reminder',
                    messageId: 0,
                };
                const notifyMsg = await this.bot.telegram.sendMessage(
                    reminder.chatId,
                    `⏰ 定时任务触发：**${reminder.content}**\n\n⏳ 正在执行...`,
                    { parse_mode: 'Markdown' }
                ).catch(() => null);

                // Override messageId so processTask can edit-in-place
                if (notifyMsg) task.messageId = notifyMsg.message_id;
                await messageQueue.enqueue(task, (t) => this.processTask(t));
            } else {
                // Simple notification
                await this.bot.telegram.sendMessage(
                    reminder.chatId,
                    `⏰ **提醒:** ${reminder.content}`,
                    { parse_mode: 'Markdown' }
                ).catch(err => console.error('[Reminder] Send failed:', err.message));
            }
        });

        // Replay interrupted message queue tasks
        const pending = await messageQueue.init();

        // Init scheduled task manager (recurring cron tasks)
        await scheduledTaskManager.init(async (task) => {
            console.log(`[ScheduledTask] Executing #${task.id}: ${task.content}`);
            try {
                const notifyMsg = await this.bot.telegram.sendMessage(
                    task.chatId,
                    `🕐 定时任务：**${task.content}**\n\n⏳ 正在执行...`,
                    { parse_mode: 'Markdown' }
                ).catch(() => null);

                const queueTask: Task = {
                    chatId: task.chatId,
                    question: task.prompt,
                    userName: 'scheduled-task',
                    messageId: notifyMsg?.message_id ?? 0,
                };
                await messageQueue.enqueue(queueTask, (t) => this.processTask(t));
            } catch (err: any) {
                console.error(`[ScheduledTask] Failed to enqueue #${task.id}:`, err.message);
                await this.bot.telegram.sendMessage(
                    task.chatId,
                    `⚠️ 定时任务「${task.content}」执行失败：${err.message}\n任务 ID: \`${task.id}\``,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
        });

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

        const projectRoot = process.env.WORK_DIR || process.cwd();

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
        const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
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
        const fileUri = await geminiUploadFile(apiKey, fileBuffer, 'audio/ogg');

        // 2. Ask Gemini to transcribe
        const text = await geminiGenerate(
            apiKey,
            [{ parts: [
                { fileData: { mimeType: 'audio/ogg', fileUri } },
                { text: '请将这段语音转录为文字，只输出转录结果，不要任何额外解释。' },
            ] }],
        );
        if (!text) throw new Error('Empty transcription result');
        return text;
    }

    /**
     * Handle incoming document messages.
     * - Plain text / code: read directly
     * - Spreadsheets (.numbers/.xlsx/.xls/.ods): convert to CSV via system tools
     * - Gemini-native binary (PDF, images, audio, video): upload to File API → fileData
     * - Other unsupported binary: reject with helpful message
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

        if (fileSizeBytes > 20 * 1024 * 1024) {
            await ctx.reply('⚠️ 文件超过 20MB，暂不支持。');
            return;
        }

        const statusMsg = await this.bot.telegram.sendMessage(chatId, `📄 正在处理文件: ${fileName}...`, {
            reply_parameters: { message_id: messageId },
        });

        const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
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

        const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';

        // ── Category 1: Plain text / code ─────────────────────────────────────
        const TEXT_MIME_PREFIXES = ['text/'];
        const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml',
            '.xml', '.ts', '.js', '.py', '.java', '.go', '.rs', '.sh', '.toml', '.ini',
            '.html', '.htm', '.css', '.sql', '.r', '.swift', '.kt', '.rb', '.php']);
        const isPlainText = TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || TEXT_EXTENSIONS.has(ext);

        // ── Category 2: Spreadsheets needing conversion ───────────────────────
        const SPREADSHEET_EXTENSIONS = new Set(['.numbers', '.xlsx', '.xls', '.ods', '.xlsm']);
        const isSpreadsheet = SPREADSHEET_EXTENSIONS.has(ext);

        // ── Category 3: Gemini File API natively supported binary ─────────────
        const GEMINI_NATIVE_MIMES = new Set([
            'application/pdf',
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
            'image/webp', 'image/heic', 'image/heif',
            'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff',
            'audio/aac', 'audio/ogg', 'audio/flac',
            'video/mp4', 'video/mpeg', 'video/mov', 'video/quicktime',
            'video/avi', 'video/webm', 'video/wmv', 'video/3gpp',
        ]);
        const isGeminiNative = GEMINI_NATIVE_MIMES.has(mimeType);

        let question: string;
        let fileUri: string | undefined;
        let fileMimeType: string | undefined;

        try {
            if (isPlainText) {
                const content = await fs.readFile(tmpPath, 'utf8');
                const truncated = content.length > 30000
                    ? content.slice(0, 30000) + '\n\n[...内容过长，已截断至前 30000 字符]'
                    : content;
                question = caption
                    ? `${caption}\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``
                    : `请分析以下文件内容并给出总结或见解。\n\n[文件名: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``;

            } else if (isSpreadsheet) {
                await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                    `📊 正在转换表格内容...`).catch(() => {});
                const csvText = await this.convertSpreadsheetToText(tmpPath, ext);
                if (!csvText) {
                    await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                        `⚠️ 无法解析 **${ext}** 格式。\n\n` +
                        `**解决方法：**\n` +
                        `• 在 Numbers / Excel 中选「文件 → 导出 → CSV」\n` +
                        `• 重新上传 **.csv** 文件\n\n` +
                        `如已安装 LibreOffice，请确保 \`soffice\` 命令可用。`,
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                    await fs.unlink(tmpPath).catch(() => {});
                    return;
                }
                const truncated = csvText.length > 30000
                    ? csvText.slice(0, 30000) + '\n\n[...内容过长，已截断]'
                    : csvText;
                question = caption
                    ? `${caption}\n\n[表格文件: ${fileName}]\n\`\`\`csv\n${truncated}\n\`\`\``
                    : `请分析下表格数据并给出总结。\n\n[表格文件: ${fileName}]\n\`\`\`csv\n${truncated}\n\`\`\``;

            } else if (isGeminiNative) {
                await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                    `📄 正在上传文件...`).catch(() => {});
                fileUri = await this.uploadToGeminiFileApi(tmpPath, mimeType);
                fileMimeType = mimeType;
                question = caption || `请分析这份文件并给出详细总结。[文件名: ${fileName}]`;
                await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                    `📄 文件已上传，正在分析...`).catch(() => {});

            } else {
                const supported = 'PDF · 图片(JPG/PNG/WebP/HEIC) · 音频(MP3/WAV/OGG) · 视频(MP4/MOV)\n文本/代码(TXT/MD/CSV/JSON/...) · 表格(Numbers/Excel → 导出为 CSV)';
                await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                    `⚠️ 暂不支持 **${ext || mimeType}** 格式。\n\n**支持的格式:**\n${supported}`,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
                await fs.unlink(tmpPath).catch(() => {});
                return;
            }
        } catch (err: any) {
            console.error(`[Document Error] Processing failed: ${err.message}`);
            await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                `⚠️ 文件处理失败: ${err.message}`).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
            return;
        }

        const task: Task = { chatId, question, userName, messageId, fileUri, fileMimeType };
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
     * Try to convert a spreadsheet file to CSV text using available system tools.
     * Tries (in order): soffice (LibreOffice), python3+openpyxl, python3 zip extraction.
     * Returns null if all methods fail.
     */
    private async convertSpreadsheetToText(filePath: string, ext: string): Promise<string | null> {
        const outDir = join(filePath, '..');

        // Method 1: LibreOffice (handles .numbers, .xlsx, .xls, .ods)
        try {
            await execa('soffice', ['--headless', '--convert-to', 'csv', '--outdir', outDir, filePath], { timeout: 30_000 });
            const csvPath = filePath.replace(/\.[^.]+$/, '.csv');
            const csv = await fs.readFile(csvPath, 'utf8');
            await fs.unlink(csvPath).catch(() => {});
            console.log(`[Document] Converted ${ext} → CSV via soffice (${csv.length} chars)`);
            return csv;
        } catch {
            console.log(`[Document] soffice not available or failed for ${ext}`);
        }

        // Method 2: python3 + openpyxl (xlsx/xls only)
        if (['.xlsx', '.xls', '.xlsm'].includes(ext)) {
            try {
                const script = [
                    'import openpyxl, sys',
                    `wb = openpyxl.load_workbook(r'${filePath}', read_only=True, data_only=True)`,
                    'out = []',
                    'for name in wb.sheetnames:',
                    '    ws = wb[name]',
                    '    out.append(f"## Sheet: {name}")',
                    '    for row in ws.iter_rows(values_only=True):',
                    '        out.append(",".join("" if v is None else str(v).replace(",",";") for v in row))',
                    'print("\\n".join(out))',
                ].join('\n');
                const { stdout } = await execa('python3', ['-c', script], { timeout: 30_000 });
                if (stdout.trim()) {
                    console.log(`[Document] Converted ${ext} → CSV via python3+openpyxl`);
                    return stdout;
                }
            } catch {
                console.log('[Document] python3+openpyxl not available or failed');
            }
        }

        // Method 3: python3 zip extraction (.numbers sometimes embeds CSV sheets)
        if (ext === '.numbers') {
            try {
                const script = [
                    'import zipfile, sys',
                    `zf = zipfile.ZipFile(r'${filePath}')`,
                    'names = [n for n in zf.namelist() if n.lower().endswith(".csv")]',
                    'if not names: sys.exit(1)',
                    'print("\\n\\n".join(zf.read(n).decode("utf-8", errors="replace") for n in names[:5]))',
                ].join('\n');
                const { stdout } = await execa('python3', ['-c', script], { timeout: 15_000 });
                if (stdout.trim()) {
                    console.log('[Document] Extracted CSV sheets from .numbers zip');
                    return stdout;
                }
            } catch {
                console.log('[Document] .numbers zip extraction found no embedded CSV');
            }
        }

        return null;
    }

    /**
     * Upload a binary file to Gemini File API and return its fileUri.
     */
    private async uploadToGeminiFileApi(filePath: string, mimeType: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

        const fileBuffer = await fs.readFile(filePath);
        return geminiUploadFile(apiKey, fileBuffer, mimeType);
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
        const tmpDir = join(process.env.WORK_DIR || process.cwd(), '.tmp');
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
            ? caption
            : '请分析并详细描述这张图片的内容。';

        const task: Task = { chatId, question, userName, messageId, imagePath: tmpPath, imageMimeType: 'image/jpeg' };
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
            // /btw — one-off Q&A, not saved to chat history
            if (rawText.startsWith('/btw')) {
                await this.handleBtwMessage(ctx, rawText, chatId, messageId, userName);
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

        // Detect recurring schedule intent: "每天", "每周", "每月", "每小时", "每隔", "每个工作日"
        const isScheduleIntent = /每(天|日|周|月|小时|隔|个工作日)/.test(rawText) ||
            /定期|每\d+(分钟|小时)/.test(rawText);
        if (isScheduleIntent) {
            await this.handleScheduledTaskMessage(ctx, rawText, chatId, messageId);
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
     * Parse and register a natural-language recurring scheduled task
     */
    private async handleScheduledTaskMessage(ctx: any, text: string, chatId: number, messageId: number) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            await ctx.reply('⚠️ 定时任务功能需要配置 GEMINI_API_KEY。', { reply_parameters: { message_id: messageId } });
            return;
        }

        const statusMsg = await this.bot.telegram.sendMessage(
            chatId, '⏳ 解析定时任务...', { reply_parameters: { message_id: messageId } }
        );

        const result = await parseScheduledTask(text, apiKey);

        if (!result) {
            await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                '⚠️ 无法解析定时任务，请换个说法。\n\n支持的格式例如：\n' +
                '• 每天早上9点告诉我杭州的天气\n' +
                '• 每周一早上8点半汇总科技新闻\n' +
                '• 每两小时提醒我喝水\n' +
                '• 每天下午6点查一下比特币价格'
            ).catch(() => {});
            return;
        }

        const task = await scheduledTaskManager.add(chatId, result.content, result.prompt, result.cronExpr);
        await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
            `✅ 定时任务已创建！\n\n` +
            `📌 任务: ${result.content}\n` +
            `📋 执行指令: ${result.prompt}\n` +
            `⏰ Cron: \`${result.cronExpr}\`\n` +
            `🆔 ID: ${task.id}\n\n` +
            `用 /unschedule ${task.id} 删除此任务`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }

    /**
     * Parse and register a natural-language reminder
     */
    private async handleReminderMessage(ctx: any, text: string, chatId: number, messageId: number) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            await ctx.reply('⚠️ 提醒功能需要配置 GEMINI_API_KEY。', { reply_parameters: { message_id: messageId } });
            return;
        }

        const statusMsg = await this.bot.telegram.sendMessage(
            chatId, '⏳ 解析提醒时间...', { reply_parameters: { message_id: messageId } }
        );

        const result = await parseReminderTime(text, apiKey);

        if (!result || !result.content) {
            await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
                '⚠️ 无法理解提醒时间，请换个说法试试。\n\n例如：\n' +
                '• 提醒我下周一早上9点开周会\n' +
                '• 提醒我这周五下午6点下班\n' +
                '• 30分钟后提醒我喝水\n' +
                '• 提醒我明天上午10点半打电话'
            ).catch(() => {});
            return;
        }

        const reminder = await reminderManager.add(chatId, result.content, result.fireAt, result.prompt);
        const fireStr = new Date(result.fireAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const typeLabel = result.prompt ? '🤖 定时任务' : '🔔 提醒通知';
        const detailLine = result.prompt
            ? `📋 任务: ${result.prompt}\n`
            : '';
        await this.bot.telegram.editMessageText(chatId, statusMsg.message_id, undefined,
            `✅ ${typeLabel}已设置！\n\n` +
            `📌 内容: ${result.content}\n` +
            detailLine +
            `🕐 时间: ${fireStr}\n` +
            `🆔 ID: ${reminder.id}\n\n` +
            `用 /remindcancel ${reminder.id} 取消`
        ).catch(() => {});
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

        // Save to history/inbox/YYYY-MM-DD-<domain>.md (consistent with CLI inbox convention)
        const inboxDir = join(
            process.env.WORK_DIR || process.cwd(),
            'history', 'inbox'
        );
        await fs.mkdir(inboxDir, { recursive: true });

        const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `${dateStr}-${domain}.md`;
        const savedPath = join(inboxDir, fileName);

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
    /**
     * Handle /btw <question> — one-off Q&A that is never saved to chat history.
     */
    private async handleBtwMessage(ctx: any, rawText: string, chatId: number, messageId: number, userName: string) {
        const question = rawText.replace(/^\/btw\s*/i, '').trim();
        if (!question) {
            await ctx.reply('用法: `/btw <问题>`\n\n临时问答，不计入对话上下文。', { parse_mode: 'Markdown' });
            return;
        }
        const task: Task = { chatId, question, userName, messageId, skipHistory: true };
        await messageQueue.enqueue(task, (t) => this.processTask(t));
    }

    private async processTask(task: Task) {
        const { chatId, question, userName, messageId } = task;

        // Hard timeout for the entire task — prevents silent hangs
        const TASK_TIMEOUT_MS = parseInt(process.env.TASK_TIMEOUT_MS || '300000', 10); // default 5 min
        let taskTimedOut = false;
        const taskTimeoutHandle = setTimeout(async () => {
            taskTimedOut = true;
            console.error(`[Worker] Task timed out after ${TASK_TIMEOUT_MS / 1000}s for: ${question.substring(0, 60)}`);
            await this.bot.telegram.sendMessage(
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

            // Prepend user profile (city, timezone, interests etc.) if available
            const profileCtx = await userProfile.toContextString();
            const context = profileCtx
                ? `${profileCtx}\n\n${historyContext}`
                : historyContext;

            const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const extraArgs: any = messageId ? { reply_parameters: { message_id: messageId } } : {};
            const agentLabel = task.skipHistory ? 'btw' : 'NeoAgent';

            // Send placeholder — will become the first streaming message
            const placeholderMsg = await this.bot.telegram.sendMessage(
                chatId, `⏳ ${agentLabel} (${timestamp})\n\n🤔 思考中...`, extraArgs
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

            const header = () => `${task.skipHistory ? '💬' : '🤖'} ${agentLabel} (${timestamp})\n\n`;

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

            const responseText = task.imagePath && task.imageMimeType
                ? await (async () => {
                    const imageData = await fs.readFile(task.imagePath!);
                    const imageInput: import('./lib/gemini-client.js').ImageInput = {
                        type: 'inline',
                        mimeType: task.imageMimeType!,
                        data: imageData.toString('base64'),
                    };
                    return geminiClient.chatWithContextStreamingWithImage(question, context, imageInput, onChunk);
                })()
                : task.fileUri && task.fileMimeType
                ? await geminiClient.chatWithContextStreamingWithFile(
                    question, context,
                    { type: 'fileUri', mimeType: task.fileMimeType, fileUri: task.fileUri },
                    onChunk
                  )
                : await geminiClient.chatWithContextStreaming(question, context, onChunk);

            // ── Final flush ──────────────────────────────────────────────────
            if (!responseText) {
                console.error(`[Worker] No response text for task from ${userName}: "${question.slice(0, 80).replace(/\n/g, ' ')}"`);
                await this.bot.telegram.editMessageText(chatId, activeMsgId, undefined, '⚠️ Failed to generate response.').catch(() => {});
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

            // Edit the last active message with whatever remains
            const finalBody = `🤖 NeoAgent (${finalTimestamp})\n\n${finalSlice || fullFormatted}`;
            await this.bot.telegram.editMessageText(chatId, activeMsgId, undefined, finalBody)
                .catch(async (err: any) => {
                    // Telegram returns "message is not modified" when the streaming already
                    // pushed identical content — this is not a real error, skip silently.
                    const desc: string = err?.description ?? err?.message ?? '';
                    if (desc.includes('message is not modified')) return;
                    await this.sendReply(chatId, responseText, 2, messageId);
                });

        } catch (error) {
            if (!taskTimedOut) {
                console.error(`[Worker Error] ${error}`);
                await this.sendReply(chatId, '🔥 处理请求时出现错误，请稍后重试。', 2, messageId);
            }
        } finally {
            clearTimeout(taskTimeoutHandle);
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
                    '这是一个极简的全能代理网关。\n\n' +
                    '**对话控制**\n' +
                    '`/new` — 开启新会话（重置上下文）\n' +
                    '`/compact` — 压缩当前上下文（保留摘要）\n' +
                    '`/clear` — 清空全部历史\n' +
                    '`/btw <问题>` — 临时问答，不计入上下文\n' +
                    '`/stats` — 查看会话统计\n\n' +
                    '**任务管理**\n' +
                    '`/tasks` — 查看后台任务\n' +
                    '`/cancel <id>` — 取消任务\n' +
                    '`/async` 或 `/research` — 提交后台长任务\n\n' +
                    '**提醒 & 定时**\n' +
                    '`/reminders` — 查看提醒\n' +
                    '`/schedules` — 查看定时任务',
                    { parse_mode: 'Markdown' }
                );
                break;

            case '/clear':
                await chatHistoryCache.clearHistory();
                await ctx.reply('🗑️ Chat history cleared. Starting fresh!');
                break;

            case '/new':
            case '/newsession':
                await chatHistoryCache.createNewSession();
                await ctx.reply('📝 新会话已开启，上下文已重置。');
                break;

            case '/compact': {
                const msgs = chatHistoryCache.getCurrentSessionHistory();
                if (msgs.length < 3) {
                    await ctx.reply('💬 当前对话太短（< 3 条），无需压缩。');
                    break;
                }
                const statusMsg = await this.bot.telegram.sendMessage(ctx.chat.id, '⏳ 正在压缩上下文...');
                const apiKey = process.env.GEMINI_API_KEY;
                if (!apiKey) {
                    await this.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 需要配置 GEMINI_API_KEY。').catch(() => {});
                    break;
                }
                const transcript = msgs.map((m: import('./lib/chat-history-cache.js').Message) => {
                    const role = m.role === 'user' ? (m.userName ?? 'User') : 'Assistant';
                    const body = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
                    return `${role}: ${body}`;
                }).join('\n\n');
                const summary = await geminiGenerate(
                    apiKey,
                    [{ parts: [{ text: `请将以下对话压缩为简洁的上下文摘要（5-10行），保留关键事实、决策和待办项，供后续对话参考：\n\n${transcript}` }] }],
                    { generationConfig: { temperature: 0.2, maxOutputTokens: 600 } }
                );
                if (!summary) {
                    await this.bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ 压缩失败，请重试。').catch(() => {});
                    break;
                }
                await chatHistoryCache.compactWithSummary(summary);
                await this.bot.telegram.editMessageText(
                    ctx.chat.id, statusMsg.message_id, undefined,
                    `✅ 上下文已压缩（${msgs.length} 条 → 1 条摘要）\n\n**摘要：**\n${summary}`,
                    { parse_mode: 'Markdown' }
                ).catch(async () => {
                    await ctx.reply(`✅ 已压缩 ${msgs.length} 条消息。\n\n摘要：\n${summary}`);
                });
                break;
            }

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

            case '/schedules': {
                const all = scheduledTaskManager.getAll();
                if (all.length === 0) {
                    await ctx.reply('🗓 暂无定时任务。\n\n发送如 "每天早上9点告诉我杭州的天气" 来创建一个。');
                    break;
                }
                const lines = all.map(t =>
                    `🔁 \`${t.id}\`  \`${t.cronExpr}\`\n   ${t.content}`
                );
                await ctx.reply(
                    `🗓 **定时任务列表 (${lines.length} 条)**\n\n` + lines.join('\n\n') +
                    '\n\n用 /unschedule <id> 删除',
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            case '/unschedule': {
                const schedId = text.split(' ')[1]?.replace(/^#/, '').trim();
                if (!schedId) {
                    await ctx.reply('用法: `/unschedule <任务ID>`', { parse_mode: 'Markdown' });
                    break;
                }
                const removed = await scheduledTaskManager.cancel(schedId);
                if (removed) {
                    await ctx.reply(`✅ 定时任务 \`#${schedId}\` 已删除。`, { parse_mode: 'Markdown' });
                } else {
                    await ctx.reply(`❌ 未找到定时任务 \`#${schedId}\`。`, { parse_mode: 'Markdown' });
                }
                break;
            }

            case '/profile': {
                const args = text.split(' ').slice(1);
                const sub = args[0];

                if (!sub || sub === 'show') {
                    await ctx.reply(
                        `👤 **个人信息**\n\n${userProfile.toDisplayString()}`,
                        { parse_mode: 'Markdown' }
                    );
                } else if (sub === 'clear') {
                    await userProfile.clear();
                    await ctx.reply('✅ 个人信息已清空。');
                } else if (sub === 'set') {
                    // /profile set city 杭州
                    // /profile set name 张三
                    // /profile set interests 科技,投资,健身
                    // /profile set notes 我是一名工程师，早上7点起床
                    const field = args[1];
                    const value = args.slice(2).join(' ');
                    if (!field || !value) {
                        await ctx.reply(
                            '用法:\n' +
                            '`/profile set name 你的名字`\n' +
                            '`/profile set city 所在城市`\n' +
                            '`/profile set timezone Asia/Shanghai`\n' +
                            '`/profile set language 中文`\n' +
                            '`/profile set interests 科技,投资,健身`\n' +
                            '`/profile set notes 自由描述，如职业、习惯等`',
                            { parse_mode: 'Markdown' }
                        );
                        break;
                    }
                    const allowed = ['name', 'city', 'timezone', 'language', 'interests', 'notes'];
                    if (!allowed.includes(field)) {
                        await ctx.reply(`❌ 不支持的字段 \`${field}\`，可用: ${allowed.join(', ')}`, { parse_mode: 'Markdown' });
                        break;
                    }
                    const patch: any = field === 'interests'
                        ? { interests: value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
                        : { [field]: value };
                    await userProfile.update(patch);
                    await ctx.reply(`✅ 已更新 ${field}。\n\n${userProfile.toDisplayString()}`, { parse_mode: 'Markdown' });
                } else {
                    await ctx.reply('用法: `/profile` 查看 | `/profile set <字段> <值>` 设置 | `/profile clear` 清空', { parse_mode: 'Markdown' });
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
        console.log(`🛠  Gemini Client enabled: ${geminiClient.isEnabled()}`);

        // Register command menu with Telegram
        this.bot.telegram.setMyCommands([
            { command: 'start',        description: '查看帮助与所有命令' },
            { command: 'new',          description: '开启新会话（重置上下文）' },
            { command: 'compact',      description: '压缩当前上下文（保留摘要）' },
            { command: 'clear',        description: '清空全部对话历史' },
            { command: 'btw',          description: '临时问答，不计入对话上下文' },
            { command: 'stats',        description: '查看会话统计' },
            { command: 'tasks',        description: '查看所有后台任务状态' },
            { command: 'cancel',       description: '取消某个任务 /cancel <id>' },
            { command: 'reminders',    description: '查看所有提醒' },
            { command: 'remindcancel', description: '取消提醒 /remindcancel <id>' },
            { command: 'schedules',    description: '查看所有定时任务' },
            { command: 'unschedule',   description: '删除定时任务 /unschedule <id>' },
            { command: 'profile',      description: '查看/设置个人信息（城市、兴趣等）' },
            { command: 'research',     description: '提交深度调研任务' },
            { command: 'async',        description: '提交后台长任务' },
        ]).then(() => console.log('[System] Bot commands registered.'))
          .catch(err => console.error('[System] Failed to register commands:', err));

        if (AUTHORIZED_CHAT_ID) {
            const timeStr = new Date().toLocaleString('zh-CN');
            this.bot.telegram.sendMessage(
                AUTHORIZED_CHAT_ID,
                `🤖 **NeoAgent Gateway** 已于 ${timeStr} 启动/重启。\n` +
                `✅ 网关已上线\n` +
                `✅ 引擎状态: ${process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'} (Direct API + Agentic Loop)`,
                { parse_mode: 'Markdown' }
            ).catch(err => console.error('[Startup Message Failed]', err));
        }

        this.bot.launch();

        // Enable graceful stop
        process.once('SIGINT', () => { reminderManager.destroy(); scheduledTaskManager.destroy(); geminiClient.close(); this.bot.stop('SIGINT'); });
        process.once('SIGTERM', () => { reminderManager.destroy(); scheduledTaskManager.destroy(); geminiClient.close(); this.bot.stop('SIGTERM'); });
    }
}

// Start the bot
const bot = new NeoAgentBot(BOT_TOKEN);
await bot.init();
bot.run();
