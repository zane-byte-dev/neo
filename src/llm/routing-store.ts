/**
 * src/llm/routing-store.ts — Persist routing config overrides under
 * $NEO_STATE_DIR/routing.json so users can edit smart routing from the UI.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyRoutingOverride, ROUTING_CONFIG, resetRoutingConfig, type RoutingConfig } from './routing-config.js';
import { log } from '../utils/logger.js';

function resolveOverridePath(): string | null {
    const stateDir = process.env.NEO_STATE_DIR?.trim();
    if (!stateDir) return null;
    return join(stateDir, 'routing.json');
}

let loaded = false;

/** Load routing overrides from disk and merge them into ROUTING_CONFIG. */
export async function loadRoutingOverrides(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const file = resolveOverridePath();
    if (!file) return;
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw) as Partial<RoutingConfig>;
        applyRoutingOverride(parsed);
        log.info('Routing', `Loaded routing overrides from ${file}`);
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') {
            log.warn('Routing', `Failed to load routing overrides: ${e.message}`);
        }
    }
}

/** Persist a partial override; writes only the user-tunable subset. */
export async function saveRoutingOverrides(partial: Partial<RoutingConfig>): Promise<void> {
    const file = resolveOverridePath();
    if (!file) throw new Error('NEO_STATE_DIR is not set; cannot persist routing overrides');
    applyRoutingOverride(partial);
    await mkdir(dirname(file), { recursive: true });
    const snapshot = {
        tiers: ROUTING_CONFIG.tiers,
        boundaries: ROUTING_CONFIG.boundaries,
        overrides: ROUTING_CONFIG.overrides,
        confidence: ROUTING_CONFIG.confidence,
        momentum: ROUTING_CONFIG.momentum,
    };
    await writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
}

/** Reset routing config back to baked-in defaults and remove the override file. */
export async function resetRoutingOverrides(): Promise<void> {
    resetRoutingConfig();
    const file = resolveOverridePath();
    if (!file) return;
    try {
        await writeFile(file, JSON.stringify({}, null, 2), 'utf8');
    } catch (err) {
        log.warn('Routing', `Failed to clear routing overrides file: ${(err as Error).message}`);
    }
}
