#!/usr/bin/env node

/**
 * main.ts — Application entry point.
 *
 * Thin bootstrap: validates env, registers platform clients, starts CoreServer.
 * To add a new platform, create a client and call server.registerClient().
 */

import { setupLogger, log } from './utils/logger.js';
import { CoreServer } from './server.js';
import { startCronAgent, stopCronAgent } from './services/cron-agent.js';
import { pruneOldRuns } from './runtime/store.js';
import { getUsersConfig } from './config.js';

// Initialize Logger
setupLogger();


// ── Build server ─────────────────────────────────────────────────────────────

const server = new CoreServer();
await server.start();
await startCronAgent();

// ── Background maintenance ────────────────────────────────────────────────────

// Prune terminal runs older than 30 days for all configured users.
// Runs in the background so startup latency is unaffected.
void (async () => {
    try {
        const users = getUsersConfig();
        let total = 0;
        for (const u of users) {
            if (u.stateDir) {
                total += await pruneOldRuns(u.stateDir);
            }
        }
        if (total > 0) log.info('Startup', `Pruned ${total} old run(s) from stateDir`);
    } catch {
        // Best-effort: never block startup.
    }
})();

// ── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
    stopCronAgent();
    await server.shutdown();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
