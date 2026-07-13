/**
 * src/config.ts — Centralized configuration.
 *
 * Single source of truth for runtime constants. No .env loading.
 * Personal/secret values (USERS, SESSION_SECRET) live in packages/agent/src/config.local.ts
 * which is gitignored — copy packages/agent/src/config.local.example.ts to bootstrap.
 */

import { loadOrBootstrapHomeConfig, printBootstrapBanner } from './services/bootstrap-config.js';

// ── Local config (gitignored) ────────────────────────────────────────────────

export interface ConfigUser {
    id: string;
    name: string;
    tenants?: string[];
    webToken?: string | null;
    /** @deprecated Neo's local model gateway was retired; this value is ignored. */
    apiToken?: string | null;
    webhookSecret?: string;
    workDir?: string;
    stateDir?: string;
}

export interface LocalConfig {
    USERS?: ConfigUser[];
    SESSION_SECRET?: string;
}

let localConfig: LocalConfig = {};
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    try {
        const localModulePath = './config.local.js';
        const mod = await import(/* @vite-ignore */ localModulePath);
        localConfig = (mod.default ?? mod) as LocalConfig;
    } catch {
        // No local config file — fall back to process.env.
    }

    const hasUsers = Array.isArray(localConfig.USERS) && localConfig.USERS.length > 0;
    if (!hasUsers && !process.env.USERS) {
        const { config: homeConfig, bootstrapped } = loadOrBootstrapHomeConfig();
        localConfig = { ...homeConfig, ...localConfig };
        if (!localConfig.SESSION_SECRET) localConfig.SESSION_SECRET = homeConfig.SESSION_SECRET;
        if (!Array.isArray(localConfig.USERS) || localConfig.USERS.length === 0) {
            localConfig.USERS = homeConfig.USERS;
        }
        if (bootstrapped) printBootstrapBanner(homeConfig);
    }
}

// ── Users ────────────────────────────────────────────────────────────────────

export function getUsersConfig(): ConfigUser[] {
    const raw = process.env.USERS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) return parsed as ConfigUser[];
        } catch { /* fall through to local config */ }
    }
    if (Array.isArray(localConfig.USERS)) return localConfig.USERS;
    return [];
}

if (!process.env.NEO_STATE_DIR) {
    const defaultStateDir = getUsersConfig().find((user) => typeof user.stateDir === 'string' && user.stateDir.trim())?.stateDir?.trim();
    if (defaultStateDir) process.env.NEO_STATE_DIR = defaultStateDir;
}

// ── Runtime accessors for credentials (read from process.env) ─

export const getGeminiApiKey   = (): string => process.env.GEMINI_API_KEY ?? '';

/** Maximum character length for user text inputs (notes, todos, messages). */
export const MAX_INPUT_LENGTH = 50_000;

/** Secret used to sign session cookies. From config.local.ts (preferred) or SESSION_SECRET env. */
export const SESSION_SECRET: string | undefined =
    localConfig.SESSION_SECRET ?? process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.error('[Config] FATAL: SESSION_SECRET is not set in packages/agent/src/config.local.ts (or SESSION_SECRET env). Refusing to start.');
    process.exit(1);
}
process.env.SESSION_SECRET = SESSION_SECRET;
