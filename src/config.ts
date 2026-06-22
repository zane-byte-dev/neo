/**
 * src/config.ts — Centralized configuration.
 *
 * Single source of truth for runtime constants. No .env loading.
 * Personal/secret values (USERS, SESSION_SECRET) live in src/config.local.ts
 * which is gitignored — copy src/config.local.example.ts to bootstrap.
 */

import { getSecret } from './services/secrets.js';
import { loadOrBootstrapHomeConfig, printBootstrapBanner } from './services/bootstrap-config.js';
import type { AgentProfile, EntrypointProfileBindings } from './agent/profiles/types.js';

// ── Local config (gitignored) ────────────────────────────────────────────────

export interface ConfigUser {
    id: string;
    name: string;
    tenants?: string[];
    webToken?: string | null;
    gatewayToken?: string | null;
    webhookSecret?: string;
    workDir?: string;
    stateDir?: string;
}

export interface LocalConfig {
    USERS?: ConfigUser[];
    SESSION_SECRET?: string;
    /** Optional declarative agent profiles (override built-ins by id). */
    PROFILES?: AgentProfile[];
    /** Optional per-entrypoint default profile bindings. */
    ENTRYPOINT_PROFILES?: EntrypointProfileBindings;
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

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseInt(v, 10) : fallback;
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

/** Optional declarative agent profiles from config (absent → built-ins only). */
export function getProfilesConfig(): AgentProfile[] {
    const raw = process.env.PROFILES;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) return parsed as AgentProfile[];
        } catch { /* fall through to local config */ }
    }
    if (Array.isArray(localConfig.PROFILES)) return localConfig.PROFILES;
    return [];
}

/** Optional per-entrypoint profile bindings from config (absent → default). */
export function getEntrypointProfiles(): EntrypointProfileBindings {
    const raw = process.env.ENTRYPOINT_PROFILES;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === 'object') return parsed as EntrypointProfileBindings;
        } catch { /* fall through to local config */ }
    }
    return localConfig.ENTRYPOINT_PROFILES ?? {};
}

if (!process.env.NEO_STATE_DIR) {
    const defaultStateDir = getUsersConfig().find((user) => typeof user.stateDir === 'string' && user.stateDir.trim())?.stateDir?.trim();
    if (defaultStateDir) process.env.NEO_STATE_DIR = defaultStateDir;
}

// ── Runtime accessors for credentials (encrypted store first, then process.env) ─

export const getDeepseekApiKey = (): string => getSecret('DEEPSEEK_API_KEY');

// Gemini API key is used by generate_video and as fallback for transcription.
export const getGeminiApiKey   = (): string => getSecret('GEMINI_API_KEY');

/** Maximum agentic tool-call iterations before forcing stop */
export const MAX_TOOL_ITERATIONS = 25;

/** Maximum tool-call iterations for subagent tasks */
export const MAX_SUBAGENT_STEPS = 10;

/** First-chunk timeout for streaming LLM requests (ms). */
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envInt('STREAM_FIRST_CHUNK_TIMEOUT_MS', 90_000);
/** Total timeout for non-streaming LLM requests (ms). */
export const GENERATE_TIMEOUT_MS = envInt('GENERATE_TIMEOUT_MS', 120_000);

/** Read-file content cap to prevent context flooding (chars) */
export const READ_FILE_CHAR_LIMIT = 50_000;

/** Model short-name aliases → real API IDs */
export const MODEL_ALIASES: Record<string, string> = {
    deepseek: 'deepseek-chat',
    'deepseek-chat': 'deepseek-chat',
    'deepseek-reasoner': 'deepseek-reasoner',
};

// ── Security ─────────────────────────────────────────────────────────────────

export const DANGEROUS_PATTERNS = [
    /\brm\s+(?:-[rf]*\s+)*\/\s*(?:[^/]|$)/,
    /\brm\s+(?:-[rf]*\s+)*\/[a-z]/,
    /\bdd\b/,
    /\bchmod\s+(?:000|777)/,
    /\bmkfs/,
    /\b(?:sudo|su)\b/,
    />\s*\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|disk\d+|rdisk\d+|loop\d+)\b/,
];

/** Maximum character length for user text inputs (notes, todos, messages). */
export const MAX_INPUT_LENGTH = 50_000;

/** Secret used to sign session cookies. From config.local.ts (preferred) or SESSION_SECRET env. */
export const SESSION_SECRET: string | undefined =
    localConfig.SESSION_SECRET ?? process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.error('[Config] FATAL: SESSION_SECRET is not set in src/config.local.ts (or SESSION_SECRET env). Refusing to start.');
    process.exit(1);
}
process.env.SESSION_SECRET = SESSION_SECRET;
