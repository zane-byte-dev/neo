/**
 * src/tools/index.ts — Auto-discovery registry for all tools.
 *
 * To add a new tool, create src/tools/my-tool.ts and export a `Tool` object.
 * It will be picked up automatically — no manual registration needed.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTool } from '../services/gemini-client.js';
import { autoLoad } from '../utils/auto-loader.js';
import type { Tool } from './_base.js';

function isTool(value: unknown): value is Tool {
    return (
        typeof value === 'object' &&
        value !== null &&
        'declaration' in value &&
        'handler' in value &&
        typeof (value as Tool).declaration?.name === 'string' &&
        typeof (value as Tool).handler === 'function'
    );
}

export async function setupTools(): Promise<void> {
    const dir = dirname(fileURLToPath(import.meta.url));
    const tools = await autoLoad(dir, isTool);

    let count = 0;
    for (const tool of tools) {
        if (tool.meta?.enabled === false) continue;
        registerTool(tool);
        count++;
    }
    console.log(`[Tools] ✅ ${count} tools registered`);
}
