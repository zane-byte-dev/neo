/**
 * src/config.ts — Centralized configuration.
 *
 * Single source of truth for runtime constants. No .env loading.
 * Personal/secret values (USERS, SESSION_SECRET) live in src/config.local.ts
 * which is gitignored — copy src/config.local.example.ts to bootstrap.
 */

import { getSecret } from './services/secrets.js';

// ── Local config (gitignored) ────────────────────────────────────────────────

export interface ConfigUser {
    id: string;
    name: string;
    tenants?: string[];
    webToken?: string | null;
    webhookSecret?: string;
    workDir?: string;
    stateDir?: string;
}

export interface LocalConfig {
    USERS?: ConfigUser[];
    SESSION_SECRET?: string;
}

let localConfig: LocalConfig = {};
// Skip loading the local config under test runners — tests own process.env.
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    try {
        // Dynamic specifier so TS doesn't fail when the file is absent (it's gitignored).
        const localModulePath = './config.local.js';
        const mod = await import(/* @vite-ignore */ localModulePath);
        localConfig = (mod.default ?? mod) as LocalConfig;
    } catch {
        // No local config file — fall back to process.env.
    }
}

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseFloat(v) : fallback;
}

// ── Users ────────────────────────────────────────────────────────────────────

/** Configured users. Sourced from config.local.ts; legacy USERS env as fallback/override (tests). */
export function getUsersConfig(): ConfigUser[] {
    // process.env.USERS takes precedence so tests / CI can stub user data
    // without touching config.local.ts.
    const raw = process.env.USERS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) return parsed as ConfigUser[];
        } catch {
            /* fall through to local config */
        }
    }
    if (Array.isArray(localConfig.USERS)) return localConfig.USERS;
    return [];
}

// Secrets are process-global; default them to the first configured user's
// stateDir so services/secrets.ts can resolve its path without importing this
// module and creating a cycle.
if (!process.env.NEO_STATE_DIR) {
    const defaultStateDir = getUsersConfig().find((user) => typeof user.stateDir === 'string' && user.stateDir.trim())?.stateDir?.trim();
    if (defaultStateDir) process.env.NEO_STATE_DIR = defaultStateDir;
}

// ── Agent / Gemini ───────────────────────────────────────────────────────────

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Runtime accessors for credentials (encrypted store first, then process.env). */
export const getGeminiApiKey   = (): string => getSecret('GEMINI_API_KEY');
export const getDeepseekApiKey = (): string => getSecret('DEEPSEEK_API_KEY');
export const getOpenAIApiKey   = (): string => getSecret('OPENAI_API_KEY');
export const getAnthropicApiKey = (): string => getSecret('ANTHROPIC_API_KEY');
export const getTelegramBotToken = (): string => getSecret('TELEGRAM_BOT_TOKEN');
export const getTelegramChatId   = (): string => getSecret('TELEGRAM_CHAT_ID');

/** Maximum agentic tool-call iterations before forcing stop */
export const MAX_TOOL_ITERATIONS = 15;

/** Maximum tool-call iterations for subagent tasks */
export const MAX_SUBAGENT_STEPS = 10;

/** Timeout for each individual Gemini API streaming request (ms) */
export const GEMINI_API_TIMEOUT_MS = 90_000;
/** First-chunk timeout for streaming LLM requests (ms). */
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envInt('STREAM_FIRST_CHUNK_TIMEOUT_MS', 90_000);
/** Total timeout for non-streaming LLM requests (ms). */
export const GENERATE_TIMEOUT_MS = envInt('GENERATE_TIMEOUT_MS', 120_000);

/** Read-file content cap to prevent context flooding (chars) */
export const READ_FILE_CHAR_LIMIT = 50_000;

/** Model short-name aliases → real API IDs */
export const MODEL_ALIASES: Record<string, string> = {
    flash: 'gemini-3-flash-preview',
    pro:   'gemini-3-pro-preview',
    deepseek: 'deepseek-chat',
    'deepseek-chat': 'deepseek-chat',
    'deepseek-reasoner': 'deepseek-reasoner',
    gemma: 'ollama/gemma4:e4b',
    'gemini-acp': 'acp/gemini',
    // OpenAI
    gpt:         'gpt-4o',
    'gpt-4o':    'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-5':     'gpt-5',
    'gpt-5-mini': 'gpt-5-mini',
    // Anthropic Claude
    claude:          'claude-sonnet-4-5',
    'claude-sonnet': 'claude-sonnet-4-5',
    'claude-opus':   'claude-opus-4-5',
    'claude-haiku':  'claude-haiku-4-5',
};

// ── Security ─────────────────────────────────────────────────────────────────

export const DANGEROUS_PATTERNS = [
    /\brm\s+(?:-[rf]*\s+)*\/\s*(?:[^/]|$)/,  // rm -rf /
    /\brm\s+(?:-[rf]*\s+)*\/[a-z]/,          // rm -rf /etc, /usr, etc.
    /\bdd\b/,                                // dd (disk writer)
    /\bchmod\s+(?:000|777)/,                 // chmod 000 or 777 on critical paths
    /\bmkfs/,                                // mkfs (format filesystem)
    /\b(?:sudo|su)\b/,                       // sudo/su (privilege escalation)
    />\s*\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|disk\d+|rdisk\d+|loop\d+)\b/, // redirect to block devices only
];

// ── Gemini / AI ───────────────────────────────────────────────────────────────

export const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
export const GEMINI_CLI_PATH  = process.env.GEMINI_CLI_PATH ?? 'gemini';
/** Raw GEMINI_MODEL env value; consumers apply their own default/alias. */
export const GEMINI_MODEL_ENV: string | undefined = process.env.GEMINI_MODEL;

/** Maximum character length for user text inputs (notes, todos, messages). */
export const MAX_INPUT_LENGTH = 50_000;
/** Daily budget limit in USD for paid model calls (0 = unlimited). */
export const DAILY_COST_LIMIT = envFloat('DAILY_COST_LIMIT', 0);

/** Secret used to sign session cookies. From config.local.ts (preferred) or SESSION_SECRET env. */
export const SESSION_SECRET: string | undefined =
    localConfig.SESSION_SECRET ?? process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.error('[Config] FATAL: SESSION_SECRET is not set in src/config.local.ts (or SESSION_SECRET env). Refusing to start.');
    process.exit(1);
}
// Mirror onto process.env so leaf modules (e.g. services/secrets.ts) can read
// it without importing config.ts and creating a cycle.
process.env.SESSION_SECRET = SESSION_SECRET;
