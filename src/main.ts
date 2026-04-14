#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger } from './utils/logger.js';
import { CoreServer } from './server.js';
import { startTelegramBot, type TelegramRuntime } from './platforms/telegram-bot.js';

// Initialize Logger
setupLogger();


// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();
await server.start();
const telegram: TelegramRuntime | null = await startTelegramBot();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
    telegram?.stop();
    await server.shutdown();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
