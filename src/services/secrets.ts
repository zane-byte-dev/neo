/**
 * src/services/secrets.ts — System-level encrypted secret storage.
 *
 * Persists API keys / tokens (Gemini, DeepSeek, OpenAI, Anthropic, …)
 * to a single AES-256-GCM encrypted JSON file. Values configured here override
 * the matching `process.env.*` so secrets can be managed from the UI rather
 * than `.env`. If a key is not present in the encrypted store the reader falls
 * back to `process.env`, preserving backward compatibility.
 *
 * Storage path:
 *   - $NEO_SECRETS_PATH when set
 *   - else $NEO_STATE_DIR/secrets.json.enc
 *
 * Encryption key is derived from SESSION_SECRET via scrypt. The same secret is
 * already required at startup in src/config.ts so we can safely depend on it.
 */

import { promises as fs, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
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
    /** Whether a non-empty value is currently available (file or env). */
    hasValue: boolean;
    /** Where the effective value comes from. */
    source: 'file' | 'env' | 'none';
    /** Last-4-chars hint, e.g. "••••CVs". Empty string when no value. */
    masked: string;
}

const MODULE = 'Secrets';
const FILE_VERSION = 1;
const ENC_ALGO = 'aes-256-gcm';
const KDF_SALT = 'neo-secrets-v1';

interface EncryptedBlob {
    v: number;
    iv: string;
    tag: string;
    data: string;
}

let cache: SecretStore | null = null;
let cacheMtimeMs: number | null = null;
let cachedKey: Buffer | null = null;

function secretsPath(): string {
    const p = secretsPathOrNull();
    if (!p) {
        throw new Error('NEO_STATE_DIR (or NEO_SECRETS_PATH) must be set to locate secrets store');
    }
    return p;
}

/** Like {@link secretsPath} but returns null when no location is configured. */
function secretsPathOrNull(): string | null {
    if (process.env.NEO_SECRETS_PATH) return process.env.NEO_SECRETS_PATH;
    const stateDir = process.env.NEO_STATE_DIR?.trim();
    if (!stateDir) return null;
    return join(stateDir, 'secrets.json.enc');
}

function getKey(): Buffer {
    if (cachedKey) return cachedKey;
    // Read SESSION_SECRET lazily (and via env, since importing config.ts here
    // would create a cycle: config.ts -> secrets.ts -> config.ts).
    const passphrase = process.env.SESSION_SECRET ?? '';
    if (!passphrase) {
        throw new Error('SESSION_SECRET must be set (in src/config.local.ts or env) to encrypt/decrypt secrets store');
    }
    cachedKey = scryptSync(passphrase, KDF_SALT, 32);
    return cachedKey;
}

function encryptStore(store: SecretStore): EncryptedBlob {
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENC_ALGO, key, iv);
    const plain = Buffer.from(JSON.stringify(store), 'utf8');
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        v: FILE_VERSION,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: enc.toString('base64'),
    };
}

function decryptStore(blob: EncryptedBlob): SecretStore {
    if (blob.v !== FILE_VERSION) {
        throw new Error(`Unsupported secrets file version: ${blob.v}`);
    }
    const key = getKey();
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const data = Buffer.from(blob.data, 'base64');
    const decipher = createDecipheriv(ENC_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return sanitizeStore(parsed as Record<string, unknown>);
}

function sanitizeStore(raw: Record<string, unknown>): SecretStore {
    const out: SecretStore = {};
    for (const k of SECRET_KEYS) {
        const v = raw[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
}

async function readStoreFromDisk(): Promise<SecretStore> {
    const path = secretsPathOrNull();
    if (!path) {
        cache = {};
        cacheMtimeMs = null;
        return cache;
    }
    try {
        const stat = await fs.stat(path);
        if (cache && cacheMtimeMs === stat.mtimeMs) return cache;
        const raw = await fs.readFile(path, 'utf8');
        const blob = JSON.parse(raw) as EncryptedBlob;
        const store = decryptStore(blob);
        cache = store;
        cacheMtimeMs = stat.mtimeMs;
        return store;
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
            throw err;
        }
        cache = {};
        cacheMtimeMs = null;
        return cache;
    }
}

/** Synchronous reader used by hot paths (LLM client, telegram). */
function readStoreSync(): SecretStore {
    if (cache) return cache;
    const path = secretsPathOrNull();
    if (!path) {
        cache = {};
        cacheMtimeMs = null;
        return cache;
    }
    try {
        const stat = statSync(path);
        const raw = readFileSync(path, 'utf8');
        const blob = JSON.parse(raw) as EncryptedBlob;
        const store = decryptStore(blob);
        cache = store;
        cacheMtimeMs = stat.mtimeMs;
        return store;
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
            throw err;
        }
        cache = {};
        cacheMtimeMs = null;
        return cache;
    }
}

/**
 * Look up a secret. Order: encrypted file → process.env[key] → ''.
 * Safe to call before any async init; uses a synchronous read on first call.
 */
export function getSecret(key: SecretKey): string {
    const store = readStoreSync();
    const fromFile = store[key];
    if (fromFile && fromFile.length > 0) return fromFile;
    const fromEnv = process.env[key];
    return fromEnv && fromEnv.length > 0 ? fromEnv : '';
}

export async function loadSecrets(): Promise<SecretStore> {
    return readStoreFromDisk();
}

function maskValue(value: string): string {
    if (!value) return '';
    const tail = value.slice(-4);
    return `••••${tail}`;
}

export async function getSecretsStatus(): Promise<Record<SecretKey, SecretStatus>> {
    const store = await readStoreFromDisk();
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

/**
 * Merge a partial update into the on-disk encrypted store.
 * - Empty string clears the entry (falls back to env on next read).
 * - Unknown keys are ignored.
 */
export async function updateSecrets(patch: Record<string, unknown>): Promise<SecretStore> {
    const current = await readStoreFromDisk();
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
    const blob = encryptStore(next);
    const path = secretsPath();
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(blob), { encoding: 'utf8', mode: 0o600 });
    try {
        await fs.chmod(path, 0o600);
    } catch {
        /* best-effort tightening on platforms that allow it */
    }
    cache = next;
    try {
        const stat = await fs.stat(path);
        cacheMtimeMs = stat.mtimeMs;
    } catch {
        cacheMtimeMs = null;
    }
    log.info(MODULE, 'Secrets updated', { keys: Object.keys(next) });
    return next;
}

/** Test helper: force the next read to hit disk again. */
export function resetSecretsCache(): void {
    cache = null;
    cacheMtimeMs = null;
    cachedKey = null;
}
