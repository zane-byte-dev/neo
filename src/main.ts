#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform adapters, starts the app.
 * To add a new platform, import its adapter and call app.registerAdapter().
 */

import { setupLogger } from './utils/logger.js';
import { AUTHORIZED_USERS, BOT_COMMANDS, getAuthorizedForPlatform } from './config.js';
import { App } from './app.js';
import { TelegramAdapter } from './platform/telegram/telegram-adapter.js';
import { getTenantContext, getAllTenantKeys } from './services/tool-context.js';

// Initialize Logger
setupLogger();

// ── Validate environment ─────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN missing.');
    process.exit(1);
}

if (AUTHORIZED_USERS.size === 0) {
    console.error('❌ No authorized users. Set AUTHORIZED_USERS or TELEGRAM_CHAT_ID.');
    process.exit(1);
}

// ── Build app ────────────────────────────────────────────────────────────────

const app = new App();

// Register Telegram adapter
const telegramAdapter = new TelegramAdapter(BOT_TOKEN);
app.registerAdapter(telegramAdapter);

// Register Feishu adapter (optional — only when env vars are set)
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;

if (FEISHU_APP_ID && FEISHU_APP_SECRET) {
    const { FeishuAdapter } = await import('./platform/feishu/feishu-adapter.js');
    const feishuAdapter = new FeishuAdapter({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET });
    app.registerAdapter(feishuAdapter);
} else {
    console.log('[Feishu] Skipped — FEISHU_APP_ID / FEISHU_APP_SECRET not set.');
}

// ── Initialize & launch ──────────────────────────────────────────────────────

await app.init();

// Register Telegram command menu
telegramAdapter.setCommands(BOT_COMMANDS)
    .then(() => console.log('[System] Telegram commands registered.'))
    .catch((err: any) => console.error('[System] Failed to register commands:', err));

// Send startup message to all Telegram tenants
const timeStr = new Date().toLocaleString('zh-CN');
const telegramTenantKeys = getAuthorizedForPlatform('telegram');
for (const tk of telegramTenantKeys) {
    const ctx = getTenantContext(tk);
    telegramAdapter.sendMessage(
        ctx.chatId,
        `🤖 **inkClaw** 已于 ${timeStr} 启动/重启。\n` +
        `✅ 网关已上线\n` +
        `✅ 引擎状态: ${process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview'} (Direct API + Agentic Loop)`,
        { parseMode: 'markdown' },
    ).catch((err: any) => console.error(`[Startup Message Failed] ${tk}:`, err));
}

await app.start();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = () => app.shutdown();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
