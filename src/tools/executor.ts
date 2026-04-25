/**
 * tool-executor.ts — Built-in tool declarations, security checks, and tool execution.
 */

import { join, dirname, isAbsolute, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { logDangerousCommand } from '../utils/audit-logger.js';
import { log } from '../utils/logger.js';
import { recordToolCall, classifyOutcome } from '../utils/tool-stats.js';
import { autoCommitWorkspaceChanges, captureGitSnapshot } from '../utils/git-auto-commit.js';
import { resolveToolPermission } from './tool-permissions.js';
import { DANGEROUS_PATTERNS, READ_FILE_CHAR_LIMIT } from '../config.js';
import { formatSandboxResult, runInSandbox } from '../sandbox/index.js';
import type { Tool, FunctionDeclaration, ToolContext } from '../llm/types.js';

/**
 * Resolve and validate a file path stays within workDir.
 * Throws if the resolved path escapes the sandbox.
 */
export function safePath(filePath: string, workDir: string): string {
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(workDir, filePath);
    if (!resolved.startsWith(resolve(workDir))) {
        throw new Error(`Path traversal blocked: ${filePath} resolves outside workDir`);
    }
    return resolved;
}

// ── Built-in tool declarations ────────────────────────────────────────────────

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: 'bash',
        description:
            'Execute a shell command in the working directory. ' +
            'Use for file search, running scripts, git operations, web requests, etc.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                timeout_ms: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default 30000, max 120000)',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_file',
        description: 'Read the text contents of a file.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute path, or path relative to the working directory',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write text content to a file, creating parent directories as needed. ' +
            'Use for creating new files or complete rewrites. ' +
            'To modify an existing file, prefer edit_file (targeted replacement) to avoid accidental overwrites.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (absolute or relative to workDir)' },
                content: { type: 'string', description: 'Text content to write' },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'list_dir',
        description: 'List the contents of a directory (directories shown first with trailing /).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path (default: working directory)' },
            },
        },
    },
];

// ── Security: dangerous command detection ─────────────────────────────────────

/**
 * Check if a command contains dangerous patterns.
 * Returns { blocked: true, reason: string } if dangerous, else { blocked: false }.
 */
export function checkDangerousCommand(command: string): { blocked: boolean; reason?: string } {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return {
                blocked: true,
                reason: `Dangerous pattern detected: ${pattern.source}`,
            };
        }
    }
    return { blocked: false };
}

function shouldSkipAutoCommit(result: string): boolean {
    return result.startsWith('[Error]') || result.startsWith('[BLOCKED]') || result.startsWith('[DENIED]');
}

// ── Tool execution ────────────────────────────────────────────────────────────

export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    workDir: string,
    toolRegistry: Map<string, Tool>,
    context?: ToolContext,
): Promise<string> {
    const tool = toolRegistry.get(name) ?? context?.userTools?.get(name);
    const permission = resolveToolPermission(name, tool);

    // Confirmation gate for dangerous-tier tools.
    if (context?.confirmCallback) {
        if (permission === 'dangerous') {
            try {
                const approved = await context.confirmCallback({ toolName: name, args });
                if (!approved) {
                    log.warn('AgentRuntime', `Tool ${name} denied by user`);
                    recordToolCall(name, 'blocked', 0);
                    return `[DENIED] User declined to run ${name}.`;
                }
            } catch (err) {
                log.error('AgentRuntime', `confirmCallback threw for ${name}`, {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

    const startedAt = Date.now();
    const gitSnapshot = permission === 'read' ? null : await captureGitSnapshot(workDir);
    const result = await executeToolInner(name, args, workDir, toolRegistry, context);
    if (permission !== 'read' && !shouldSkipAutoCommit(result)) {
        await autoCommitWorkspaceChanges(name, gitSnapshot, 'AgentRuntime');
    }
    recordToolCall(name, classifyOutcome(result), Date.now() - startedAt);
    return result;
}

async function executeToolInner(
    name: string,
    args: Record<string, unknown>,
    workDir: string,
    toolRegistry: Map<string, Tool>,
    context?: ToolContext,
): Promise<string> {
    log.info('AgentRuntime', `Tool: ${name}(${JSON.stringify(args).slice(0, 120)})`);

    try {
        switch (name) {
            case 'bash': {
                const command = String(args.command ?? '');
                
                // Security: Check for dangerous commands
                const danger = checkDangerousCommand(command);
                if (danger.blocked) {
                    log.warn('Security', `Dangerous command blocked: ${command.slice(0, 100)}`);
                    await logDangerousCommand(command, true, danger.reason);
                    return `[BLOCKED] Dangerous command pattern detected: ${danger.reason}`;
                }

                // Log non-dangerous external API calls
                if (command.includes('curl') || command.includes('wget') || command.includes('python')) {
                    await logDangerousCommand(command, false, 'External API call');
                }

                const timeoutMs = Math.min(Number(args.timeout_ms ?? 30_000), 120_000);
                const result = await runInSandbox(command, {
                    workDir,
                    timeoutMs,
                    signal: context?.signal,
                });
                // Rich output: auto-push generated images to the chat UI.
                if (result.artifacts?.length && context?.imageCallback) {
                    for (const art of result.artifacts) {
                        if (!art.mimeType?.startsWith('image/')) continue;
                        try {
                            const abs = join(workDir, art.path);
                            const buf = await fs.readFile(abs);
                            await context.imageCallback(buf.toString('base64'), art.mimeType, art.path);
                        } catch (err) {
                            log.warn('Sandbox', `Failed to stream artifact ${art.path}`, {
                                error: err instanceof Error ? err.message : String(err),
                            });
                        }
                    }
                }
                return formatSandboxResult(result);
            }

            case 'read_file': {
                const filePath = String(args.path ?? '');
                const resolved = safePath(filePath, workDir);
                let content = await fs.readFile(resolved, 'utf8');
                
                // Guard against enormous files flooding the context window
                let wasTruncated = false;
                if (content.length > READ_FILE_CHAR_LIMIT) {
                    content = content.slice(0, READ_FILE_CHAR_LIMIT) +
                        `\n\n[...truncated: ${content.length - READ_FILE_CHAR_LIMIT} additional chars omitted]`;
                    wasTruncated = true;
                }
                
                // Wrap external content in markers to prevent prompt injection
                const wrapped = `[EXTERNAL_CONTENT]
Source: ${resolved}${wasTruncated ? ' (TRUNCATED)' : ''}
─────────────────────────────────
${content}
─────────────────────────────────
[/EXTERNAL_CONTENT]`;
                
                return wrapped;
            }

            case 'write_file': {
                const filePath = String(args.path ?? '');
                const content = String(args.content ?? '');
                const resolved = safePath(filePath, workDir);
                await fs.mkdir(dirname(resolved), { recursive: true });
                await fs.writeFile(resolved, content, 'utf8');
                return `OK: wrote ${content.length} chars to ${resolved}`;
            }

            case 'list_dir': {
                const dirPath = String(args.path ?? '.');
                const resolved = safePath(dirPath, workDir);
                const entries = await fs.readdir(resolved, { withFileTypes: true });
                const sorted = entries.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                return sorted.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
            }

            default: {
                const tool = toolRegistry.get(name);
                if (tool) {
                    const result = await tool.handler(args, workDir, context);
                    return result;
                }
                return `[Error] Unknown tool: ${name}`;
            }
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('AgentRuntime', `Tool error (${name}): ${msg}`);
        if (err instanceof Error && err.stack) {
            log.error('AgentRuntime', `Stack:\n${err.stack}`);
        }
        return `[Error] ${name} failed: ${msg}`;
    }
}
