/**
 * audit-logger.ts — Thin shim over the unified logger.
 * Preserved for backwards-compatible imports in tool-executor and other callers.
 */

import { log } from './logger.js';

export function logDangerousCommand(
    command: string,
    blocked: boolean,
    reason?: string,
): Promise<void> {
    const level = blocked ? 'critical' : 'warn';
    log[level]('bash', blocked ? 'DANGEROUS_COMMAND_BLOCKED' : 'DANGEROUS_COMMAND_EXECUTED', {
        command: command.slice(0, 500),
        reason,
    });
    return Promise.resolve();
}

