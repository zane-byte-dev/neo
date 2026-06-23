/**
 * src/services/secrets.ts — API key / token storage.
 *
 * Reads from ~/.neo/config.json under a "secrets" key. Falls back to
 * process.env for each key. Plain JSON, no encryption — same approach
 * as Claude Code's file-based config.
 */

import { promises as fs, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { log } from '../utils/logger.js';

export type SecretKey =
    | 'GEMINI_API_KEY'
    | 'DEEPSEEK_API_KEY'
    | 'OPENAI_API_KEY'
    | 'ANTHROPIC_API_KEY'
    | 'CLAUDE_CODE_BASE_URL'
    | 'CLAUDE_CODE_TOKEN';

export const SECRET_KEYS: readonly SecretKey[] = [
    'GEMINI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_BASE_URL',
    'CLAUDE_CODE_TOKEN',
];

export type SecretStore = Partial<Record<SecretKey, string>>;

export interface SecretStatus {
    hasValue: boolean;
    source: 'file' | 'env' | 'none';
    masked: string;
}

const MODULE = 'Secrets';
const DEFAULT_CONFIG_PATH = join(homedir(), '.neo', 'config.json');

function configPath(): string {
    return process.env.NEO_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

let cache: SecretStore | null = null;
let cacheMtimeMs: number | null = null;

function readConfigSecrets(): SecretStore {
    try {
        if (!existsSync(configPath())) return {};
        const raw = JSON.parse(readFileSync(configPath(), 'utf8'));
        const secrets = raw?.secrets;
        if (!secrets || typeof secrets !== 'object') return {};
        return sanitizeStore(secrets);
    } catch {
        return {};
    }
}

async function readConfigSecretsAsync(): Promise<SecretStore> {
    try {
        const p = configPath();
        const stat = await fs.stat(p);
        if (cache && cacheMtimeMs === stat.mtimeMs) return cache;
        const raw = JSON.parse(await fs.readFile(p, 'utf8'));
        const secrets = raw?.secrets;
        if (!secrets || typeof secrets !== 'object') {
            cache = {};
        } else {
            cache = sanitizeStore(secrets);
        }
        cacheMtimeMs = stat.mtimeMs;
        return cache;
    } catch {
        cache = {};
        cacheMtimeMs = null;
        return cache;
    }
}

function sanitizeStore(raw: Record<string, unknown>): SecretStore {
    const out: SecretStore = {};
    for (const k of SECRET_KEYS) {
        const v = raw[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
}

export function getSecret(key: SecretKey): string {
    const store = readConfigSecrets();
    const fromFile = store[key];
    if (fromFile && fromFile.length > 0) return fromFile;
    const fromEnv = process.env[key];
    return fromEnv && fromEnv.length > 0 ? fromEnv : '';
}

function maskValue(value: string): string {
    if (!value) return '';
    return `••••${value.slice(-4)}`;
}

export async function getSecretsStatus(): Promise<Record<SecretKey, SecretStatus>> {
    const store = await readConfigSecretsAsync();
    const out = {} as Record<SecretKey, SecretStatus>;
    for (const k of SECRET_KEYS) {
        const fileVal = store[k];
        const envVal = process.env[k];
        if (fileVal && fileVal.length > 0) {
            out[k] = { hasValue: true, source: 'file', masked: maskValue(fileVal) };
        } else if (envVal && envVal.length > 0) {
            out[k] = { hasValue: true, source: 'env', masked: maskValue(envVal) };
        } else {
            out[k] = { hasValue: false, source: 'none', masked: '' };
        }
    }
    return out;
}

export async function updateSecrets(patch: Record<string, unknown>): Promise<SecretStore> {
    const current = await readConfigSecretsAsync();
    const next: SecretStore = { ...current };
    for (const k of SECRET_KEYS) {
        if (!(k in patch)) continue;
        const v = patch[k];
        if (typeof v !== 'string') continue;
        const trimmed = v.trim();
        if (trimmed.length === 0) {
            delete next[k];
        } else {
            next[k] = trimmed;
        }
    }

    const p = configPath();
    let config: Record<string, unknown> = {};
    try {
        config = JSON.parse(await fs.readFile(p, 'utf8'));
    } catch { /* new file */ }

    config.secrets = next;
    await fs.mkdir(dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    cache = next;
    try {
        const stat = await fs.stat(p);
        cacheMtimeMs = stat.mtimeMs;
    } catch {
        cacheMtimeMs = null;
    }
    log.info(MODULE, 'Secrets updated', { keys: Object.keys(next) });
    return next;
}

export function resetSecretsCache(): void {
    cache = null;
    cacheMtimeMs = null;
}
