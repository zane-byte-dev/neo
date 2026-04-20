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
import { startCronAgent, stopCronAgent } from './services/cron-agent.js';
import { tryStartAcp, shutdownAcp } from './llm/providers/gemini-acp.js';

// Initialize Logger
setupLogger();


// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();
await server.start();
const telegram: TelegramRuntime | null = await startTelegramBot();
await startCronAgent(telegram);
tryStartAcp(); // eagerly start Gemini CLI ACP process (non-blocking)

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
    stopCronAgent();
    shutdownAcp();
    telegram?.stop();
    await server.shutdown();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
