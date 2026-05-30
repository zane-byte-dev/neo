#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger } from './utils/logger.js';
import { CoreServer } from './server.js';
import { startCronAgent, stopCronAgent } from './services/cron-agent.js';
import { shutdownAcp } from './llm/providers/gemini-acp.js';
import { loadRoutingOverrides } from './llm/routing-store.js';

// Initialize Logger
setupLogger();


// ── Build server ─────────────────────────────────────────────────────────────

await loadRoutingOverrides();
const server = new CoreServer();
await server.start();
await startCronAgent();
// ACP process is started lazily on first request with the correct user workDir.

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
    stopCronAgent();
    shutdownAcp();
    await server.shutdown();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
