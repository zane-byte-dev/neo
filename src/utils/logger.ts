/**
 * Logger Utility for inkClaw
 * Provides global timestamp prefixing for console methods.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

let logDirReady = false;
let isWritingLog = false;
let loggerInitialized = false;

function ensureLogDir(): string {
    const dir = join(process.cwd(), 'logs', 'runtime');
    if (!logDirReady) {
        mkdirSync(dir, { recursive: true });
        logDirReady = true;
    }
    return dir;
}

function getLogFilePath(now: Date): string {
    const date = now.toISOString().split('T')[0];
    return join(ensureLogDir(), `${date}.log`);
}

function formatArgs(args: any[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            return inspect(arg, { depth: 4, breakLength: 120, compact: true });
        })
        .join(' ');
}

function appendRuntimeLog(level: 'INFO' | 'WARN' | 'ERROR', now: Date, args: any[]): void {
    if (isWritingLog) return;

    try {
        isWritingLog = true;
        const time = now.toTimeString().split(' ')[0];
        const line = `[${now.toISOString().split('T')[0]} ${time}] [${level}] ${formatArgs(args)}\n`;
        appendFileSync(getLogFilePath(now), line, 'utf8');
    } finally {
        isWritingLog = false;
    }
}

export function setupLogger() {
    if (loggerInitialized) return;
    loggerInitialized = true;

    const originalLog = console.log;
    const originalError = console.error;
    const originalInfo = console.info;
    const originalWarn = console.warn;

    const getTimestamp = () => {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0];
        return `[${date} ${time}]`;
    };

    console.log = (...args: any[]) => {
        const now = new Date();
        originalLog(getTimestamp(), ...args);
        appendRuntimeLog('INFO', now, args);
    };

    console.error = (...args: any[]) => {
        const now = new Date();
        originalError(getTimestamp(), ...args);
        appendRuntimeLog('ERROR', now, args);
    };

    console.info = (...args: any[]) => {
        const now = new Date();
        originalInfo(getTimestamp(), ...args);
        appendRuntimeLog('INFO', now, args);
    };

    console.warn = (...args: any[]) => {
        const now = new Date();
        originalWarn(getTimestamp(), ...args);
        appendRuntimeLog('WARN', now, args);
    };
}
