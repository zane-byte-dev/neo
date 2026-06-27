/**
 * src/routes/index.ts — Auto-discovery registry for all route modules.
 *
 * To add routes, create a new file in src/routes/ and export a `register`
 * function. It will be picked up automatically — no manual registration needed.
 *
 * Convention: each route file exports named route functions + a `register`
 * function that mounts them all onto the provided router.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Router from '@koa/router';
import { autoLoad } from '@neo/agent/utils/auto-loader.js';
import { log } from '@neo/agent/utils/logger.js';

function isRouteHandler(value: unknown): value is (router: Router) => void {
    return typeof value === 'function';
}

export async function setupRoutes(router: Router): Promise<void> {
    const dir = dirname(fileURLToPath(import.meta.url));
    const handlers = await autoLoad(dir, isRouteHandler);
    for (const handler of handlers) {
        handler(router);
    }
    log.info('Routes', `${handlers.length} route handlers registered`);
}
