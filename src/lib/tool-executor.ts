/**
 * tool-executor.ts — Built-in tool declarations, security checks, and tool execution.
 */

import { join, dirname, isAbsolute } from 'node:path';
import { promises as fs } from 'node:fs';
import { execa } from 'execa';
import { logDangerousCommand, logToolExecution } from './audit-logger.js';
import { DANGEROUS_PATTERNS, READ_FILE_CHAR_LIMIT } from '../config.js';
import type { Tool, FunctionDeclaration } from './gemini-types.js';

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
        description: 'Write text content to a file, creating parent directories as needed.',
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

// ── Tool execution ────────────────────────────────────────────────────────────

export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    workDir: string,
    toolRegistry: Map<string, Tool>,
): Promise<string> {
    console.log(`[AgentRuntime] Tool: ${name}(${JSON.stringify(args).slice(0, 120)})`);
    const startedAt = Date.now();

    const finish = async (result: string, status: 'ok' | 'blocked' | 'error' = 'ok'): Promise<string> => {
        const elapsedMs = Date.now() - startedAt;
        const summary = `${status} (${elapsedMs}ms) ${result.replace(/\s+/g, ' ').slice(0, 220)}`;
        await logToolExecution(name, args, summary);
        return result;
    };

    try {
        switch (name) {
            case 'bash': {
                const command = String(args.command ?? '');
                
                // Security: Check for dangerous commands
                const danger = checkDangerousCommand(command);
                if (danger.blocked) {
                    console.warn(`[Security] Dangerous command blocked: ${command.slice(0, 100)}`);
                    await logDangerousCommand(command, true, danger.reason);
                    return finish(`[BLOCKED] Dangerous command pattern detected: ${danger.reason}`, 'blocked');
                }

                // Log non-dangerous external API calls
                if (command.includes('curl') || command.includes('wget') || command.includes('python')) {
                    await logDangerousCommand(command, false, 'External API call');
                }

                const timeoutMs = Math.min(Number(args.timeout_ms ?? 30_000), 120_000);
                const proc = await execa('sh', ['-c', command], {
                    cwd: workDir,
                    timeout: timeoutMs,
                    reject: false,
                    all: true,
                });
                const out = [
                    proc.stdout?.trim(),
                    proc.stderr?.trim() ? `[stderr]\n${proc.stderr.trim()}` : '',
                ]
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                return finish(out || '(no output)');
            }

            case 'read_file': {
                const filePath = String(args.path ?? '');
                const resolved = isAbsolute(filePath) ? filePath : join(workDir, filePath);
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
                
                return finish(wrapped);
            }

            case 'write_file': {
                const filePath = String(args.path ?? '');
                const content = String(args.content ?? '');
                const resolved = isAbsolute(filePath) ? filePath : join(workDir, filePath);
                await fs.mkdir(dirname(resolved), { recursive: true });
                await fs.writeFile(resolved, content, 'utf8');
                return finish(`OK: wrote ${content.length} chars to ${resolved}`);
            }

            case 'list_dir': {
                const dirPath = String(args.path ?? '.');
                const resolved = isAbsolute(dirPath) ? dirPath : join(workDir, dirPath);
                const entries = await fs.readdir(resolved, { withFileTypes: true });
                const sorted = entries.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                return finish(sorted.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n'));
            }

            default: {
                const tool = toolRegistry.get(name);
                if (tool) {
                    const result = await tool.handler(args, workDir);
                    return finish(result);
                }
                return finish(`[Error] Unknown tool: ${name}`, 'error');
            }
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentRuntime] Tool error (${name}): ${msg}`);
        return finish(`[Error] ${name} failed: ${msg}`, 'error');
    }
}
