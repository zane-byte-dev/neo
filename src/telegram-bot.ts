#!/usr/bin/env node

import { Telegraf } from 'telegraf';
import { join, resolve } from 'path';
import { promises as fs } from 'fs';
import { BOT_COMMANDS, ASYNC_TRIGGER_PREFIXES, CACHE_DIR } from './config.js';
import { GeminiClient } from './lib/gemini-client.js';
import { ChatHistoryCache } from './lib/chat-history-cache.js';
import { setupLogger } from './utils/logger.js';
import { AsyncTaskManager } from './lib/async-task-manager.js';
import { MessageQueue } from './lib/message-queue.js';
import { ReminderManager } from './lib/reminder-manager.js';
import { ScheduledTaskManager } from './lib/scheduled-task-manager.js';
import { UserProfileManager } from './lib/user-profile.js';
import { setupTools } from './tools/index.js';
import { setupCommands, handleCommand as handleCommandFn } from './commands/index.js';
import { closeBrowser } from './lib/browser-service.js';
import { setupCronJobs } from './crons/index.js';
import { setupHandlers } from './bot/handlers.js';
import { initLifecycle } from './bot/lifecycle.js';
import { sendReply as sendReplyFn } from './bot/reply.js';
import { processTask as processTaskFn } from './bot/task-processor.js';
import { findFiles as findFilesFn } from './utils/file-search.js';
import { processMessage as processMessageFn } from './bot/message-router.js';
import { handleUrlMessage as handleUrlMessageFn } from './bot/url-handler.js';
import {
    processPhotoMessage as processPhotoMessageFn,
    processVoiceMessage as processVoiceMessageFn,
    processDocumentMessage as processDocumentMessageFn,
} from './bot/media-handler.js';
import { handleAsyncTask as handleAsyncTaskFn, setupAsyncPolling as setupAsyncPollingFn } from './bot/async-handler.js';
import type { Task } from './bot/types.js';


// Initialize Logger
setupLogger();

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

// Bot commands defined in src/config.ts (single source of truth)

// Auto-discover and register pluggable tools & commands
await setupTools();
await setupCommands();

// Initialize Gemini client
const geminiClient = new GeminiClient();

// Initialize chat history cache
const chatHistoryCache = new ChatHistoryCache();
await chatHistoryCache.init();

// Session-to-Log: whenever a session expires (idle timeout), immediately dehydrate it.
// This complements the 23:59 cron — mid-day session switches won't be missed.
chatHistoryCache.setOnSessionExpire(async (session) => {
    if (session.messages.length === 0) return;
    try {
        const { generateDailyLogTool } = await import('./tools/generate-daily-log.js');
        const result = await generateDailyLogTool.handler({}, '');
        console.log(`[SessionExpire] ${result}`);
    } catch (err: any) {
        console.error('[SessionExpire] session-to-log failed:', err.message);
    }
});

// Persistent message queue — survives bot restarts

// Initialize async task manager
const asyncTaskManager = new AsyncTaskManager(CACHE_DIR);
await asyncTaskManager.init();

// Async trigger prefixes defined in src/config.ts
const messageQueue = new MessageQueue(CACHE_DIR);

// Reminder manager
const reminderManager = new ReminderManager(CACHE_DIR);

// Scheduled (recurring) task manager
const scheduledTaskManager = new ScheduledTaskManager(CACHE_DIR);

// User profile
const userProfile = new UserProfileManager(CACHE_DIR);

class inkClawBot {
    private bot: Telegraf;
    private activeTaskIds = new Set<string>();
    private pendingReadMatches = new Map<number, { matches: string[]; expiry: number }>();

    constructor(token: string) {
        this.bot = new Telegraf(token);
        setupHandlers({
            bot: this.bot,
            handleCommand: (ctx) => this.handleCommand(ctx),
            processMessage: (ctx) => this.processMessage(ctx),
            processPhotoMessage: (ctx) => this.processPhotoMessage(ctx),
            processVoiceMessage: (ctx) => this.processVoiceMessage(ctx),
            processDocumentMessage: (ctx) => this.processDocumentMessage(ctx),
            handleCallbackQuery: (ctx) => this.handleCallbackQuery(ctx),
        });
        setupCronJobs({
            chatId: AUTHORIZED_CHAT_ID!,
            sendReply: (chatId, text) => this.sendReply(chatId, text),
        });
        setupAsyncPollingFn({
            asyncTaskManager,
            geminiClient,
            sendReply: (chatId, text, retries, replyToMessageId) => this.sendReply(chatId, text, retries, replyToMessageId),
            activeTaskIds: this.activeTaskIds,
        });
        console.log('[System] Background worker queue started.');
    }

    async init() {
        await initLifecycle({
            bot: this.bot,
            userProfile,
            reminderManager,
            scheduledTaskManager,
            messageQueue,
            authorizedChatId: AUTHORIZED_CHAT_ID,
            processTask: (task) => this.processTask(task),
        });
    }

    private async processTask(task: Task) {
        return processTaskFn(
            {
                bot: this.bot,
                geminiClient,
                chatHistoryCache,
                userProfile,
                sendReply: (chatId, text, retries, replyToMessageId) => this.sendReply(chatId, text, retries, replyToMessageId),
            },
            task
        );
    }

    private async sendReply(chatId: number, text: string, retries: number = 2, replyToMessageId?: number) {
        return sendReplyFn(this.bot, chatId, text, retries, replyToMessageId);
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

    private async handleAsyncTask(ctx: any) {
        return handleAsyncTaskFn(
            {
                asyncTaskManager,
                geminiClient,
                sendReply: (chatId, text, retries, replyToMessageId) => this.sendReply(chatId, text, retries, replyToMessageId),
                activeTaskIds: this.activeTaskIds,
            },
            ctx
        );
    }

    private async processMessage(ctx: any) {
        return processMessageFn(
            {
                bot: this.bot,
                isAuthorized: (chatId) => this.isAuthorized(chatId),
                asyncTriggerPrefixes: ASYNC_TRIGGER_PREFIXES,
                pendingReadMatches: this.pendingReadMatches,
                scheduledTaskManager,
                reminderManager,
                messageQueue,
                processTask: (task) => this.processTask(task),
                handleAsyncTask: (innerCtx) => this.handleAsyncTask(innerCtx),
                handleCommand: (innerCtx) => this.handleCommand(innerCtx),
                handleUrlMessage: (innerCtx, url, rawText, userName, chatId, messageId) =>
                    this.handleUrlMessage(innerCtx, url, rawText, userName, chatId, messageId),
            },
            ctx
        );
    }

    private async handleUrlMessage(
        ctx: any,
        url: string,
        rawText: string,
        userName: string,
        chatId: number,
        messageId: number
    ) {
        return handleUrlMessageFn(
            {
                bot: this.bot,
                messageQueue,
                processTask: (task) => this.processTask(task),
            },
            ctx,
            url,
            rawText,
            userName,
            chatId,
            messageId
        );
    }

    private async processVoiceMessage(ctx: any) {
        return processVoiceMessageFn(
            {
                bot: this.bot,
                messageQueue,
                processTask: (task) => this.processTask(task),
            },
            ctx,
            (chatId) => this.isAuthorized(chatId)
        );
    }

    private async processDocumentMessage(ctx: any) {
        return processDocumentMessageFn(
            {
                bot: this.bot,
                messageQueue,
                processTask: (task) => this.processTask(task),
            },
            ctx,
            (chatId) => this.isAuthorized(chatId)
        );
    }

    private async processPhotoMessage(ctx: any) {
        return processPhotoMessageFn(
            {
                bot: this.bot,
                messageQueue,
                processTask: (task) => this.processTask(task),
            },
            ctx,
            (chatId) => this.isAuthorized(chatId)
        );
    }

    private async handleCommand(ctx: any) {
        return handleCommandFn(
            {
                bot: this.bot,
                chatHistoryCache,
                asyncTaskManager,
                reminderManager,
                scheduledTaskManager,
                userProfile,
                pendingReadMatches: this.pendingReadMatches,
                findFiles: (query, baseDir, resolvedBase) => this.findFiles(query, baseDir, resolvedBase),
            },
            ctx
        );
    }

    private async findFiles(query: string, baseDir: string, resolvedBase: string, depth = 0): Promise<string[]> {
        return findFilesFn(query, baseDir, resolvedBase, depth);
    }

    private async handleCallbackQuery(ctx: any) {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        if (data === 'save_lib') {
            const workDir = process.env.WORK_DIR;
            if (!workDir) {
                await ctx.answerCbQuery('⚠️ WORK_DIR 未配置').catch(() => {});
                return;
            }

            const msgText: string = ctx.callbackQuery.message?.text || '';
            // Strip the bot header: optional "[N/M]\n" prefix + "🤖 inkClaw (HH:MM)\n\n"
            const content = msgText.replace(/^(?:\[\d+\/\d+\]\n)?🤖 inkClaw \(\d{2}:\d{2}\)\n\n/, '');

            if (!content.trim()) {
                await ctx.answerCbQuery('❌ 消息内容为空').catch(() => {});
                return;
            }

            try {
                const now = new Date();
                const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
                const timeStr = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).replace(':', '');
                const title = `saved-${dateStr}-${timeStr}`;

                const targetDir = join(resolve(workDir), '3-Library', 'Wiki');
                await fs.mkdir(targetDir, { recursive: true });
                const filePath = join(targetDir, `${title}.md`);

                const dateTimeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                await fs.writeFile(filePath, `# ${title}\n\n${content}\n\n---\n\n时间: ${dateTimeStr}\n`, 'utf-8');

                // Update button to reflect saved state
                await ctx.editMessageReplyMarkup({
                    inline_keyboard: [[{ text: `✅ 已保存 → Wiki/${title}.md`, callback_data: 'saved_noop' }]]
                }).catch(() => {});
                await ctx.answerCbQuery('✅ 已保存到 3-Library/Wiki/').catch(() => {});
            } catch (err: any) {
                console.error('[SaveCallback] Error:', err.message);
                await ctx.answerCbQuery('❌ 保存失败: ' + err.message).catch(() => {});
            }
        } else if (data === 'saved_noop') {
            await ctx.answerCbQuery('已保存过了').catch(() => {});
        }
    }

    /**
     * Start the bot
     */
    run() {
        console.log(`🤖 Bot started. Auth Chat ID: ${AUTHORIZED_CHAT_ID || 'ALL'}`);
        console.log(`🛠  Gemini Client enabled: ${geminiClient.isEnabled()}`);

        // Register command menu with Telegram — derived from BOT_COMMANDS (single source of truth)
        this.bot.telegram.setMyCommands(BOT_COMMANDS)
          .then(() => console.log('[System] Bot commands registered.'))
          .catch(err => console.error('[System] Failed to register commands:', err));

        if (AUTHORIZED_CHAT_ID) {
            const timeStr = new Date().toLocaleString('zh-CN');
            this.bot.telegram.sendMessage(
                AUTHORIZED_CHAT_ID,
                `🤖 **inkClaw ** 已于 ${timeStr} 启动/重启。\n` +
                `✅ 网关已上线\n` +
                `✅ 引擎状态: ${process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'} (Direct API + Agentic Loop)`,
                { parse_mode: 'Markdown' }
            ).catch(err => console.error('[Startup Message Failed]', err));
        }

        this.bot.launch();

        // Enable graceful stop
        process.once('SIGINT', () => { reminderManager.destroy(); scheduledTaskManager.destroy(); geminiClient.close(); closeBrowser(); this.bot.stop('SIGINT'); });
        process.once('SIGTERM', () => { reminderManager.destroy(); scheduledTaskManager.destroy(); geminiClient.close(); closeBrowser(); this.bot.stop('SIGTERM'); });
    }
}

// Start the bot
const bot = new inkClawBot(BOT_TOKEN);
await bot.init();
bot.run();
