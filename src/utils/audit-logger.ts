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

export function logToolExecution(
    toolName: string,
    args: Record<string, unknown>,
    resultSummary?: string,
): Promise<void> {
    log.info('tool-execution', `TOOL_${toolName.toUpperCase()}`, {
        args: JSON.stringify(args).slice(0, 300),
        resultSummary,
    });
    return Promise.resolve();
}

export function logSuspiciousInput(
    source: string,
    content: string,
    reason: string,
): Promise<void> {
    log.warn('input-validation', 'SUSPICIOUS_INPUT_DETECTED', {
        source,
        contentPreview: content.slice(0, 200),
        reason,
    });
    return Promise.resolve();
}

