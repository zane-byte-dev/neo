/**
 * src/web/server.ts — Deprecated shim.
 *
 * Web server functionality has moved to src/platform/web/web-adapter.ts.
 * Register WebAdapter in main.ts; it will start the Koa server on adapter.start().
 *
 * This file is kept so existing imports of startWebServer do not break.
 * It is now a no-op — the WebAdapter handles everything.
 */

import type { GeminiClient } from '../services/gemini-client.js';

/** @deprecated Use WebAdapter instead. */
export function startWebServer(_geminiClient: GeminiClient): void {
    // No-op: WebAdapter.start() handles server startup.
}
