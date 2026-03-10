#!/usr/bin/env node

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import PQueue from 'p-queue';
import { execa } from 'execa';
import { join } from 'path';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { markdownToTelegram } from './lib/markdown-converter.js';
import { setupLogger } from './lib/logger.js';
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

// Pre-flight: Clean up orphaned gemini processes to avoid pipe blockage
try {
    // Use a temporary direct execa call since geminiClient isn't ready
    await execa('pkill', ['-f', 'gemini --experimental-acp']).catch(() => { });
} catch (e) { }

// Initialize Gemini client
const geminiClient = new GeminiClient();

// Initialize chat history cache
const chatHistoryCache = new ChatHistoryCache();

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

    constructor(token: string) {
        this.bot = new Telegraf(token);
        this.setupHandlers();
        this.setupCronJobs();
        console.log('[System] Background worker queue started.');
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

        // Error handling
        this.bot.catch((err, ctx) => {
            console.error(`[Bot Error] ${err}`);
        });
    }

    /**
     * Check if user is authorized
     */
    private isAuthorized(chatId: number): boolean {
        if (AUTHORIZED_CHAT_ID === null) {
            return true;
        }
        return chatId === AUTHORIZED_CHAT_ID;
    }

    /**
     * Process incoming messages
     */
    private async processMessage(ctx: any) {
        const chatId = ctx.chat.id;
        const text = ctx.message.text;
        const messageId = ctx.message.message_id;
        const userName = ctx.chat.first_name || 'User';

        // Log received message
        const preview = text.length > 50 ? `${text.substring(0, 50)}...` : text;
        console.log(`[Message] From ${userName} (ID: ${chatId}, MsgID: ${messageId}): ${preview}`);

        // Authorization check
        if (!this.isAuthorized(chatId)) {
            await ctx.reply('⛔ Unauthorized.');
            return;
        }

        // Handle commands separately
        if (text.startsWith('/')) {
            await this.handleCommand(ctx);
            return;
        }

        // Add task to queue for async processing
        const task: Task = { chatId, question: text, userName, messageId };
        taskQueue.add(() => this.processTask(task));
    }

    /**
     * Worker logic: process queued tasks
     */
    private async processTask(task: Task) {
        const { chatId, question, userName, messageId } = task;

        try {
            console.log(`[Worker] Processing task for ${userName}: ${question.substring(0, 20)}...`);

            // Add user message to cache
            await chatHistoryCache.addMessage('user', question, userName);

            // Get conversation context for Gemini
            const context = chatHistoryCache.getContextForGemini();

            // Generate response with context
            const responseText = await geminiClient.chatWithContext(question, context);

            if (!responseText) {
                await this.sendReply(chatId, '⚠️ Failed to generate response.', 2, messageId);
                return;
            }

            // Add assistant message to cache
            await chatHistoryCache.addMessage('assistant', responseText);

            // Send reply to user
            await this.sendReply(chatId, responseText, 2, messageId);
        } catch (error) {
            console.error(`[Worker Error] ${error}`);
            await this.sendReply(
                chatId,
                '🔥 处理请求时出现错误，请稍后重试。',
                2,
                messageId
            );
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
                    // Send message with reply_to_message_id if available
                    await this.bot.telegram.sendMessage(chatId, chunkPrefix + chunk, {
                        reply_to_message_id: replyToMessageId
                    });
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
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

// Start the bot
const bot = new NeoAgentBot(BOT_TOKEN);
bot.run();
