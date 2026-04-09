#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform adapters, starts the app.
 * To add a new platform, import its adapter and call app.registerAdapter().
 */

import { setupLogger } from './utils/logger.js';
import { AUTHORIZED_USERS, BOT_COMMANDS, getAuthorizedForPlatform, TELEGRAM_BOT_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET, GEMINI_MODEL_ENV } from './config.js';
import { App } from './app.js';
import { TelegramAdapter } from './platform/telegram/telegram-adapter.js';

// Initialize Logger
setupLogger();

// ── Validate environment ─────────────────────────────────────────────────────

if (!TELEGRAM_BOT_TOKEN) {
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
const telegramAdapter = new TelegramAdapter(TELEGRAM_BOT_TOKEN);
app.registerAdapter(telegramAdapter);

// Register Feishu adapter (optional — only when env vars are set)
if (FEISHU_APP_ID && FEISHU_APP_SECRET) {
    const { FeishuAdapter } = await import('./platform/feishu/feishu-adapter.js');
    const feishuAdapter = new FeishuAdapter({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET });
    app.registerAdapter(feishuAdapter);
} else {
    console.log('[Feishu] Skipped — FEISHU_APP_ID / FEISHU_APP_SECRET not set.');
}

// Register Web adapter (optional — only when WEB_PORT or WEB_ENABLED is set)
if (process.env.WEB_PORT ?? process.env.WEB_ENABLED) {
    const { WebAdapter } = await import('./platform/web/web-adapter.js');
    const webAdapter = new WebAdapter(app.geminiClient);
    app.registerAdapter(webAdapter);
} else {
    console.log('[Web] Skipped — WEB_PORT / WEB_ENABLED not set.');
}

// ── Initialize & launch ──────────────────────────────────────────────────────

await app.init();

// Register Telegram command menu
telegramAdapter.setCommands(BOT_COMMANDS)
    .then(() => console.log('[System] Telegram commands registered.'))
    .catch((err: any) => console.error('[System] Failed to register commands:', err));

await app.start();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = () => app.shutdown();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
