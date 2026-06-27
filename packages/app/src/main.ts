#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger } from '@neo/agent/utils/logger.js';
import { CoreServer } from './server.js';
import { startCronAgent, stopCronAgent } from './services/cron-agent.js';

// Initialize Logger
setupLogger();


// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();
await server.start();
await startCronAgent();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
    stopCronAgent();
    await server.shutdown();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
