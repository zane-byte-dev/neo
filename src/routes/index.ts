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
import { autoLoad } from '../utils/auto-loader.js';
import type { RouteContext, RouteRegistrar } from './_base.js';

function isRouteRegistrar(value: unknown): value is RouteRegistrar {
    return typeof value === 'function' && (value as { name?: string }).name === 'register';
}

export async function setupRoutes(router: Router, ctx: RouteContext): Promise<void> {
    const dir = dirname(fileURLToPath(import.meta.url));
    const registrars = await autoLoad(dir, isRouteRegistrar);
    for (const register of registrars) {
        register(router, ctx);
    }
    console.log(`[Routes] ✅ ${registrars.length} route modules loaded`);
}
