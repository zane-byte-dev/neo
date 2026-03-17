import { promises as fs } from 'fs';
import { join } from 'path';

const AUDIT_LOG_DIR = join(process.cwd(), 'logs/audit');

interface AuditEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'CRITICAL';
    module: string;
    action: string;
    details?: Record<string, unknown>;
}

/**
 * Write an audit entry to the audit log.
 * Async operation — logs are written asynchronously to avoid blocking.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
    try {
        await fs.mkdir(AUDIT_LOG_DIR, { recursive: true });
        const logFile = join(AUDIT_LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
        const line = JSON.stringify(entry) + '\n';
        await fs.appendFile(logFile, line, 'utf8');
    } catch (err) {
        console.error('[AuditLogger] Failed to write log:', (err as Error).message);
    }
}

/**
 * Log a dangerous command attempt (blocked or executed).
 */
export function logDangerousCommand(
    command: string,
    blocked: boolean,
    reason?: string
): Promise<void> {
    return auditLog({
        timestamp: new Date().toISOString(),
        level: blocked ? 'CRITICAL' : 'WARN',
        module: 'bash',
        action: blocked ? 'DANGEROUS_COMMAND_BLOCKED' : 'DANGEROUS_COMMAND_EXECUTED',
        details: {
            command: command.slice(0, 500),
            reason,
        },
    });
}

/**
 * Log an external API call or tool execution.
 */
export function logToolExecution(
    toolName: string,
    args: Record<string, unknown>,
    resultSummary?: string
): Promise<void> {
    return auditLog({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        module: 'tool-execution',
        action: `TOOL_${toolName.toUpperCase()}`,
        details: {
            args: JSON.stringify(args).slice(0, 300),
            resultSummary,
        },
    });
}

/**
 * Log a prompt injection attempt or suspicious input.
 */
export function logSuspiciousInput(
    source: string,
    content: string,
    reason: string
): Promise<void> {
    return auditLog({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        module: 'input-validation',
        action: 'SUSPICIOUS_INPUT_DETECTED',
        details: {
            source,
            contentPreview: content.slice(0, 200),
            reason,
        },
    });
}
