#!/usr/bin/env node
/**
 * Telegram Bot 对话模式 (Async Worker Edition)
 * 集成 NeoAgent CLI (Gemini CLI) 进行深度思考
 */

import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters.js';
import PQueue from 'p-queue';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { ConversationSaver } from './lib/conversation-saver.js';
import { markdownToTelegram } from './lib/markdown-converter.js';
import { runClipper, runAudioRefinery, runEbookRefinery } from './lib/tool-runner.js';

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

// Initialize Gemini client
const geminiClient = new GeminiClient();

// Initialize chat history cache
const chatHistoryCache = new ChatHistoryCache();

// Initialize conversation saver (optional, saves Q&A to vault)
const conversationSaver = new ConversationSaver();

// Task queue (Producer-Consumer model)
const taskQueue = new PQueue({ concurrency: 1 });

interface Task {
    chatId: number;
    question: string;
    userName: string;
}

class NeoAgentBot {
    private bot: Telegraf;

    constructor(token: string) {
        this.bot = new Telegraf(token);
        this.setupHandlers();
        console.log('[System] Background worker queue started.');
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
        const userName = ctx.chat.first_name || 'User';

        // Log received message
        const preview = text.length > 50 ? `${text.substring(0, 50)}...` : text;
        console.log(`[Message] From ${userName} (ID: ${chatId}): ${preview}`);

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

        // Quick ACK to user
        await ctx.reply('🧠 Thinking...');

        // Add task to queue for async processing
        const task: Task = { chatId, question: text, userName };
        taskQueue.add(() => this.processTask(task));
    }

    /**
     * Worker logic: process queued tasks
     */
    private async processTask(task: Task) {
        const { chatId, question, userName } = task;

        try {
            console.log(`[Worker] Processing task for ${userName}: ${question.substring(0, 20)}...`);

            // Add user message to cache
            await chatHistoryCache.addMessage('user', question, userName);

            // Get conversation context for Gemini
            const context = chatHistoryCache.getContextForGemini();

            // Generate response with context
            const responseText = await geminiClient.chatWithContext(question, context);

            if (!responseText) {
                await this.sendReply(chatId, '⚠️ Failed to generate response.');
                return;
            }

            // Add assistant message to cache
            await chatHistoryCache.addMessage('assistant', responseText);

            // Append to daily verbatim transcript in vault (01_日记/会话/)
            await conversationSaver.saveConversation(question, responseText, userName);

            // Send reply to user
            await this.sendReply(chatId, responseText);
        } catch (error) {
            console.error(`[Worker Error] ${error}`);
            await this.sendReply(
                chatId,
                '🔥 处理请求时出现错误，请稍后重试。'
            );
        }
    }

    /**
     * Send final reply to user with retry and timeout handling
     */
    private async sendReply(chatId: number, text: string, retries: number = 2) {
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
                    // Send as plain text (no parse_mode)
                    await this.bot.telegram.sendMessage(chatId, chunkPrefix + chunk);
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

                // If single line is too long, split it
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
        const [command, ...argParts] = text.split(' ');
        const arg = argParts.join(' ').trim();

        console.log(`[Command] Received: ${command}`);

        switch (command) {
            case '/start':
                await ctx.reply(
                    '🔭 **NeoAgent Connector Ready**\n' +
                    'Send any message to chat, or use a command:\n\n' +
                    '`/clip <url>` — 抓取网页保存到 vault\n' +
                    '`/audioify <file_or_dir>` — Markdown → MP3\n' +
                    '`/epub <file>` — EPUB → Markdown 章节\n' +
                    '`/clear` — 清空对话历史\n' +
                    '`/newsession` — 开启新会话\n' +
                    '`/stats` — 查看统计',
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

            case '/clip': {
                if (!arg) { await ctx.reply('Usage: /clip <url>'); break; }
                await ctx.reply(`✂️ Clipping: ${arg}`);
                taskQueue.add(async () => {
                    const result = await runClipper(arg);
                    const reply = result.success
                        ? `✅ Clipped!\n\n${result.output}`
                        : `❌ Clip failed:\n${result.error}`;
                    await this.sendReply(ctx.chat.id, reply);
                });
                break;
            }

            case '/audioify': {
                if (!arg) { await ctx.reply('Usage: /audioify <file_or_dir> [voice]'); break; }
                const [target, voice] = arg.split(' ');
                await ctx.reply(`🎧 Audioifying: ${target}\n(这可能需要几分钟...)`);
                taskQueue.add(async () => {
                    const result = await runAudioRefinery(target, voice);
                    const reply = result.success
                        ? `✅ Done!\n\n${result.output}`
                        : `❌ Audio failed:\n${result.error}`;
                    await this.sendReply(ctx.chat.id, reply);
                });
                break;
            }

            case '/epub': {
                if (!arg) { await ctx.reply('Usage: /epub <file.epub>'); break; }
                await ctx.reply(`📚 Refining EPUB: ${arg}`);
                taskQueue.add(async () => {
                    const result = await runEbookRefinery(arg);
                    const reply = result.success
                        ? `✅ Done!\n\n${result.output}`
                        : `❌ EPUB failed:\n${result.error}`;
                    await this.sendReply(ctx.chat.id, reply);
                });
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

        this.bot.launch();

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

// Start the bot
const bot = new NeoAgentBot(BOT_TOKEN);
bot.run();
