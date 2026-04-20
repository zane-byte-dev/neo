/**
 * src/config.ts — Centralized configuration.
 * Single source of truth for env variables, constants, and tunables.
 */

import { config as loadEnv } from 'dotenv';
loadEnv();
import { resolve } from 'path';

// ── Helpers ──────────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseFloat(v) : fallback;
}

// ── Agent / Gemini ───────────────────────────────────────────────────────────

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Maximum agentic tool-call iterations before forcing stop */
export const MAX_TOOL_ITERATIONS = 15;

/** Maximum tool-call iterations for subagent tasks */
export const MAX_SUBAGENT_STEPS = 10;

/** Timeout for each individual Gemini API streaming request (ms) */
export const GEMINI_API_TIMEOUT_MS = 90_000;

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
};

// ── File system ──────────────────────────────────────────────────────────────

export const DB_PATH = process.env.DB_PATH || './data/neo.db';
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp', '__pycache__', 'dist', '.cache']);
export const MAX_SEARCH_DEPTH = 6;

// ── Security ─────────────────────────────────────────────────────────────────

export const DANGEROUS_PATTERNS = [
    /\brm\s+(?:-[rf]*\s+)*\/\s*(?:[^/]|$)/,  // rm -rf /
    /\brm\s+(?:-[rf]*\s+)*\/[a-z]/,          // rm -rf /etc, /usr, etc.
    /\bdd\b/,                                // dd (disk writer)
    /\bchmod\s+(?:000|777)/,                 // chmod 000 or 777 on critical paths
    /\bmkfs/,                                // mkfs (format filesystem)
    /\b(?:sudo|su)\b/,                       // sudo/su (privilege escalation)
    />\s*\/dev\/[a-z]/,                      // redirect to /dev/sda, /dev/null, etc.
];

// ── Gemini / AI ───────────────────────────────────────────────────────────────

export const GEMINI_API_KEY   = process.env.GEMINI_API_KEY ?? '';
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
export const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
export const GEMINI_CLI_PATH  = process.env.GEMINI_CLI_PATH ?? 'gemini';
/** Raw GEMINI_MODEL env value; consumers apply their own default/alias. */
export const GEMINI_MODEL_ENV: string | undefined = process.env.GEMINI_MODEL;
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

/** Maximum character length for user text inputs (notes, todos, messages). */
export const MAX_INPUT_LENGTH = 50_000;
/** Daily budget limit in USD for paid model calls (0 = unlimited). */
export const DAILY_COST_LIMIT = envFloat('DAILY_COST_LIMIT', 0);

/** Secret used to sign session cookies. Must be set via SESSION_SECRET env var. */
export const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.error('[Config] FATAL: SESSION_SECRET env var is not set. Refusing to start with an insecure default.');
    process.exit(1);
}
