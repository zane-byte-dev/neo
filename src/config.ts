/**
 * src/config.ts — Centralized configuration.
 * Single source of truth for env variables, constants, and tunables.
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

// ── Helpers ──────────────────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    return v ? parseInt(v, 10) : fallback;
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
];

// ── Agent / Gemini ───────────────────────────────────────────────────────────

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_FILES_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

/** Maximum agentic tool-call iterations before forcing stop */
export const MAX_TOOL_ITERATIONS = 15;

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

export const CACHE_DIR = process.env.CHAT_CACHE_DIR || './cache';
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

// ── Cron ─────────────────────────────────────────────────────────────────────

export const CRON_SCHEDULES = {
    butler:       '0 2 * * *',
    curator:      '30 9 * * *',
    sessionLog:   '59 23 * * *',
    weeklyReport: '0 21 * * 0',
} as const;
