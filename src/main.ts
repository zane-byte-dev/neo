#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger } from './utils/logger.js';
import { AUTHORIZED_USERS,  } from './config.js';
import { CoreServer } from './server.js';

// Initialize Logger
setupLogger();

// ── Validate environment ─────────────────────────────────────────────────────

if (AUTHORIZED_USERS.size === 0) {
    console.error('❌ No authorized users. Set AUTHORIZED_USERS or TELEGRAM_CHAT_ID.');
    process.exit(1);
}

// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();
await server.start();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = () => server.shutdown();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
