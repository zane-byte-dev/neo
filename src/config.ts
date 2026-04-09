/**
 * src/config.ts — Centralized configuration.
 * Single source of truth for env variables, constants, and tunables.
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { resolve } from 'path';
import { readFileSync } from 'fs';
import type { TenantKey, Platform, UserId } from './types/platform.js';
import { makeTenantKey } from './types/platform.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseInt(v, 10) : fallback;
}

// ── User map (users.json) ────────────────────────────────────────────────────

export interface UserEntry {
    tenants: TenantKey[];
    /** Per-user web Bearer token. Maps this user from WebUI requests. */
    webToken?: string;
}

/** userId → UserEntry */
const _userMap = new Map<UserId, UserEntry>();
/** tenantKey → userId (reverse index) */
const _tenantToUser = new Map<TenantKey, UserId>();
/** webToken → userId (reverse index) */
const _webTokenToUser = new Map<string, UserId>();

function loadUserMap(): void {
    // Try loading from the workspace directory, fall back to space/
    const candidates = [
        resolve(process.env.WORK_DIR || '.', 'users.json'),
        resolve('space', 'users.json'),
    ];
    for (const path of candidates) {
        try {
            const raw = readFileSync(path, 'utf8');
            const data = JSON.parse(raw) as Record<string, { tenants: string[]; webToken?: string }>;
            for (const [userId, entry] of Object.entries(data)) {
                const tenants = (entry.tenants ?? []) as TenantKey[];
                _userMap.set(userId, { tenants, webToken: entry.webToken });
                for (const tk of tenants) {
                    _tenantToUser.set(tk, userId);
                }
                if (entry.webToken) {
                    _webTokenToUser.set(entry.webToken, userId);
                }
            }
            console.log(`[Config] 📋 Loaded ${_userMap.size} user(s) from ${path}`);
            return;
        } catch { /* try next */ }
    }
    console.warn('[Config] ⚠️  users.json not found; falling back to AUTHORIZED_USERS env.');
}

loadUserMap();

/** Get all defined users */
export function getAllUsers(): Map<UserId, UserEntry> {
    return _userMap;
}

/** Resolve a tenantKey to its owning userId. Returns undefined if not mapped. */
export function resolveUserId(tenantKey: TenantKey): UserId | undefined {
    return _tenantToUser.get(tenantKey);
}

/** Get all tenantKeys belonging to a userId */
export function getUserTenants(userId: UserId): TenantKey[] {
    return _userMap.get(userId)?.tenants ?? [];
}

/** Resolve a webToken (from Authorization header) to its owning userId. Returns undefined if not mapped. */
export function resolveUserIdByWebToken(token: string): UserId | undefined {
    return _webTokenToUser.get(token);
}

/** Returns true if at least one user has a webToken configured in users.json. */
export function hasWebTokens(): boolean {
    return _webTokenToUser.size > 0;
}

// ── Multi-tenant authorization ───────────────────────────────────────────────

/**
 * Authorized tenants: derived from users.json if available, otherwise from
 * AUTHORIZED_USERS env var (legacy).
 */
function parseAuthorizedUsers(): Set<TenantKey> {
    // Prefer users.json
    if (_tenantToUser.size > 0) {
        return new Set(_tenantToUser.keys());
    }
    // Legacy: AUTHORIZED_USERS env var
    const raw = process.env.AUTHORIZED_USERS;
    if (raw) {
        const keys = raw.split(',').map(s => s.trim()).filter(Boolean) as TenantKey[];
        return new Set(keys);
    }
    // Legacy fallback: single Telegram user
    const legacyChatId = process.env.TELEGRAM_CHAT_ID;
    if (legacyChatId) {
        return new Set([makeTenantKey('telegram', legacyChatId)]);
    }
    return new Set();
}

export const AUTHORIZED_USERS: ReadonlySet<TenantKey> = parseAuthorizedUsers();

/** Quick auth check */
export function isAuthorized(tenantKey: TenantKey): boolean {
    return AUTHORIZED_USERS.has(tenantKey);
}

/** Get all authorized tenants for a specific platform */
export function getAuthorizedForPlatform(platform: Platform): TenantKey[] {
    return [...AUTHORIZED_USERS].filter(k => k.startsWith(`${platform}:`));
}

// ── Bot ──────────────────────────────────────────────────────────────────────

/** Keywords that trigger background async tasks */
export const ASYNC_TRIGGER_PREFIXES = ['调研', '重构'];

/** Bot command definitions for Telegram /setMyCommands */
export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
    { command: 'start',        description: '查看帮助与所有命令' },
    { command: 'new',          description: '开启新会话（重置上下文）' },
    { command: 'compact',      description: '压缩当前上下文（保留摘要）' },
    { command: 'clear',        description: '清空全部对话历史' },
    { command: 'btw',          description: '临时问答，不计入对话上下文' },
    { command: 'stats',        description: '查看会话统计' },
    { command: 'tasks',        description: '查看所有后台任务状态' },
    { command: 'cancel',       description: '取消某个任务 /cancel <id>' },
    { command: 'reminders',    description: '查看所有提醒' },
    { command: 'remindcancel', description: '取消提醒 /remindcancel <id>' },
    { command: 'schedules',    description: '查看所有定时任务' },
    { command: 'unschedule',   description: '删除定时任务 /unschedule <id>' },
    { command: 'profile',      description: '查看/设置个人信息（城市、兴趣等）' },
    { command: 'research',     description: '提交深度调研任务' },
    { command: 'async',        description: '提交后台长任务' },
    { command: 'ls',           description: '列出 workspace 目录内容（零 token）' },
    { command: 'read',         description: '直接读取文件内容，不经过 AI（零 token）' },
    { command: 'note',         description: '快速记录碎片到 Inbox（零 token）/note <内容>' },
    { command: 'today',        description: '查看今日 Inbox 与日记（零 token）' },
    { command: 'task',         description: '快速追加任务到 Tasks（零 token）/task <内容>' },
    { command: 'search',       description: '全文搜索 vault（零 token）/search <关键词>' },
    { command: 'weekly',       description: '立即生成本周周报' },
    { command: 'save',         description: '回复消息保存到 Library（零 token）/save [子目录/]标题' },
];

// ── Agent / Gemini ───────────────────────────────────────────────────────────

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_FILES_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

/** Maximum agentic tool-call iterations before forcing stop */
export const MAX_TOOL_ITERATIONS = 15;

/** Timeout for each individual Gemini API streaming request (ms) */
export const GEMINI_API_TIMEOUT_MS = 90_000;

/** Read-file content cap to prevent context flooding (chars) */
export const READ_FILE_CHAR_LIMIT = 50_000;

/** Gemini model short-name aliases → real API IDs */
export const MODEL_ALIASES: Record<string, string> = {
    flash: 'gemini-3-flash-preview',
    pro:   'gemini-3-pro-preview',
};

// ── Task processing ──────────────────────────────────────────────────────────

export const TASK_TIMEOUT_MS = envInt('TASK_TIMEOUT_MS', 300_000);
export const EDIT_INTERVAL_MS = 1200;
export const CHUNK_LIMIT = 3800;

// ── File system ──────────────────────────────────────────────────────────────

export const DB_PATH = process.env.DB_PATH || './data/neo.db';
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp', '__pycache__', 'dist', '.cache']);
export const MAX_SEARCH_DEPTH = 6;

// ── Media handling ───────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export const TEXT_MIME_PREFIXES = ['text/'];

export const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.csv', '.json', '.yaml', '.yml',
    '.xml', '.ts', '.js', '.py', '.java', '.go', '.rs', '.sh', '.toml', '.ini',
    '.html', '.htm', '.css', '.sql', '.r', '.swift', '.kt', '.rb', '.php',
]);

export const SPREADSHEET_EXTENSIONS = new Set(['.numbers', '.xlsx', '.xls', '.ods', '.xlsm']);

export const GEMINI_NATIVE_MIMES = new Set([
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/heic', 'image/heif',
    'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff',
    'audio/aac', 'audio/ogg', 'audio/flac',
    'video/mp4', 'video/mpeg', 'video/mov', 'video/quicktime',
    'video/avi', 'video/webm', 'video/wmv', 'video/3gpp',
]);

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

// ── Platform credentials ──────────────────────────────────────────────────────

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
export const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   ?? '';
export const FEISHU_APP_ID      = process.env.FEISHU_APP_ID      ?? '';
export const FEISHU_APP_SECRET  = process.env.FEISHU_APP_SECRET  ?? '';

// ── Gemini / AI ───────────────────────────────────────────────────────────────

export const GEMINI_API_KEY   = process.env.GEMINI_API_KEY ?? '';
/** Raw GEMINI_MODEL env value; consumers apply their own default/alias. */
export const GEMINI_MODEL_ENV: string | undefined = process.env.GEMINI_MODEL;
export const GEMINI_WORK_DIR  = process.env.GEMINI_WORK_DIR ?? '';

// ── Agent / workspace paths ───────────────────────────────────────────────────

export const WORK_DIR       = process.env.WORK_DIR ?? '';
export const AGENT_CONFIG_DIR = process.env.AGENT_CONFIG_DIR
    ? resolve(process.env.AGENT_CONFIG_DIR)
    : '';
