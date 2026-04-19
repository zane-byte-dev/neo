/**
 * logger.ts — Unified structured logger.
 *
 * Single source of truth for all log output. Replaces audit-logger,
 * runtime logger, and debug-logger.
 *
 * Levels (ascending): DEBUG < INFO < WARN < ERROR < CRITICAL
 *
 * Configuration (env vars):
 *   LOG_LEVEL=debug|info|warn|error|critical   (default: info)
 *   DEBUG_LLM=1                                 (shorthand for LOG_LEVEL=debug)
 *
 * Output:
 *   File : logs/YYYY-MM-DD.jsonl   (one JSON entry per line)
 *   Stderr: coloured human-readable (levels >= LOG_LEVEL)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';

// ── Level definitions ─────────────────────────────────────────────────────────

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

const LEVEL_RANK: Record<Level, number> = {
    DEBUG:    0,
    INFO:     1,
    WARN:     2,
    ERROR:    3,
    CRITICAL: 4,
};

const LEVEL_COLOR: Record<Level, string> = {
    DEBUG:    '\x1b[90m',  // grey
    INFO:     '\x1b[37m',  // white
    WARN:     '\x1b[33m',  // yellow
    ERROR:    '\x1b[31m',  // red
    CRITICAL: '\x1b[35m',  // magenta
};
const RESET = '\x1b[0m';

// ── Config ────────────────────────────────────────────────────────────────────

function resolveMinLevel(): Level {
    if (process.env.DEBUG_LLM === '1') return 'DEBUG';
    const raw = (process.env.LOG_LEVEL ?? 'info').toUpperCase() as Level;
    return raw in LEVEL_RANK ? raw : 'INFO';
}

const MIN_LEVEL: Level = resolveMinLevel();

// ── File sink ─────────────────────────────────────────────────────────────────

const LOG_DIR = join(process.cwd(), 'logs');
let logDirReady = false;
let isWriting = false;

function ensureLogDir(): void {
    if (!logDirReady) {
        mkdirSync(LOG_DIR, { recursive: true });
        logDirReady = true;
    }
}

function writeEntry(entry: Record<string, unknown>): void {
    if (isWriting) return;
    isWriting = true;
    ensureLogDir();
    const date = new Date().toISOString().slice(0, 10);
    appendFile(join(LOG_DIR, `${date}.jsonl`), JSON.stringify(entry) + '\n', 'utf8')
        .catch(() => { /* never crash over logging */ })
        .finally(() => { isWriting = false; });
}

// ── Core emit ─────────────────────────────────────────────────────────────────

export interface LogData {
    module?: string;
    [key: string]: unknown;
}

function emit(level: Level, module: string, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

    const ts = new Date().toISOString();
    const entry: Record<string, unknown> = { ts, level, module, msg };
    if (data && Object.keys(data).length > 0) entry.data = data;

    // File sink (always, if level passes filter)
    writeEntry(entry);

    // Stderr sink (human-readable)
    const color = LEVEL_COLOR[level];
    const prefix = `${color}[${ts.slice(0, 19).replace('T', ' ')}] [${level.padEnd(8)}] [${module}]${RESET}`;
    const dataSuffix = (data && Object.keys(data).length > 0)
        ? ` ${inspect(data, { depth: 4, breakLength: 160, compact: true })}`
        : '';
    process.stderr.write(`${prefix} ${msg}${dataSuffix}\n`);
}

// ── Public logger API ─────────────────────────────────────────────────────────

export const log = {
    debug(module: string, msg: string, data?: Record<string, unknown>): void {
        emit('DEBUG', module, msg, data);
    },
    info(module: string, msg: string, data?: Record<string, unknown>): void {
        emit('INFO', module, msg, data);
    },
    warn(module: string, msg: string, data?: Record<string, unknown>): void {
        emit('WARN', module, msg, data);
    },
    error(module: string, msg: string, data?: Record<string, unknown>): void {
        emit('ERROR', module, msg, data);
    },
    critical(module: string, msg: string, data?: Record<string, unknown>): void {
        emit('CRITICAL', module, msg, data);
    },
};

// ── Console monkey-patch (replaces old setupLogger) ───────────────────────────

let loggerInitialized = false;

function formatConsoleArgs(args: unknown[]): string {
    return args
        .map(a => (typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: 120, compact: true })))
        .join(' ');
}

export function setupLogger(): void {
    if (loggerInitialized) return;
    loggerInitialized = true;

    const orig = {
        log:   console.log.bind(console),
        info:  console.info.bind(console),
        warn:  console.warn.bind(console),
        error: console.error.bind(console),
    };

    // Local-time prefix for stdout — stays human-readable in the terminal.
    const prefix = (level: Level) => {
        const n = new Date();
        const color = LEVEL_COLOR[level];
        return `[${n.toISOString().slice(0, 10)} ${n.toTimeString().slice(0, 8)}] ${color}[${level}]${RESET}`;
    };

    // Write to the JSONL file only — do NOT call emit() which would also print
    // to stderr and produce duplicate lines in the terminal.
    const toFile = (level: Level, args: unknown[]) => {
        if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
        writeEntry({ ts: new Date().toISOString(), level, module: 'console', msg: formatConsoleArgs(args) });
    };

    console.log = (...args: unknown[]) => {
        orig.log(prefix('INFO'), ...args);
        toFile('INFO', args);
    };
    console.info = (...args: unknown[]) => {
        orig.info(prefix('INFO'), ...args);
        toFile('INFO', args);
    };
    console.warn = (...args: unknown[]) => {
        orig.warn(prefix('WARN'), ...args);
        toFile('WARN', args);
    };
    console.error = (...args: unknown[]) => {
        orig.error(prefix('ERROR'), ...args);
        toFile('ERROR', args);
    };
}

// ── Exposed for introspection ─────────────────────────────────────────────────

export const isDebugEnabled = (): boolean => LEVEL_RANK[MIN_LEVEL] <= LEVEL_RANK['DEBUG'];
