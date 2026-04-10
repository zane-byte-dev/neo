#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger } from './utils/logger.js';
import { AUTHORIZED_USERS, BOT_COMMANDS, TELEGRAM_BOT_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET } from './config.js';
import { CoreServer } from './server.js';
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

// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();

// Register Telegram client
const telegramAdapter = new TelegramAdapter(TELEGRAM_BOT_TOKEN, server);
server.registerClient(telegramAdapter);

// Register Feishu client (optional — only when env vars are set)
if (FEISHU_APP_ID && FEISHU_APP_SECRET) {
    const { FeishuAdapter } = await import('./platform/feishu/feishu-adapter.js');
    const feishuAdapter = new FeishuAdapter({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET }, server);
    server.registerClient(feishuAdapter);
} else {
    console.log('[Feishu] Skipped — FEISHU_APP_ID / FEISHU_APP_SECRET not set.');
}

// Web is handled directly by CoreServer — no separate adapter needed.
// Set WEB_PORT or WEB_ENABLED env var to enable the HTTP server.
if (!(process.env.WEB_PORT ?? process.env.WEB_ENABLED)) {
    console.log('[Web] Skipped — WEB_PORT / WEB_ENABLED not set.');
}

// ── Initialize & launch ──────────────────────────────────────────────────────

await server.init();

// Register Telegram command menu
telegramAdapter.setCommands(BOT_COMMANDS)
    .then(() => console.log('[System] Telegram commands registered.'))
    .catch((err: any) => console.error('[System] Failed to register commands:', err));

await server.start();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = () => server.shutdown();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
