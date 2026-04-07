/**
 * handlers.ts — Event handler setup.
 *
 * With the adapter pattern, platform-specific event registration is handled
 * inside each PlatformAdapter. This module is now a thin coordination layer
 * that wires the adapter's normalized events to the core processing pipeline.
 */

import type { PlatformAdapter, NormalizedMessage, NormalizedCallback } from '../types/platform.js';

interface HandlersDeps {
    adapter: PlatformAdapter;
    processMessage: (msg: NormalizedMessage) => Promise<void>;
    handleCallbackQuery: (cb: NormalizedCallback) => Promise<void>;
}

export function setupHandlers(deps: HandlersDeps) {
    deps.adapter.onMessage(async (msg: NormalizedMessage) => {
        await deps.processMessage(msg);
    });

    deps.adapter.onCallbackQuery(async (cb: NormalizedCallback) => {
        await deps.handleCallbackQuery(cb);
    });
}
