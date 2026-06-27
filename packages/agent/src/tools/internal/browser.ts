/**
 * src/tools/internal/browser.ts — Browser automation via agent-browser CLI.
 *
 * Wraps the `agent-browser` CLI (https://github.com/vercel-labs/agent-browser)
 * to give the AI agent full browser control: navigate, click, fill, snapshot,
 * screenshot, eval JS, and more.
 *
 * Each user+session gets an isolated browser instance via `--session <id>`.
 * Screenshot output is forwarded to the client via `context.imageCallback`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Tool } from '../_base.js';

const execFileAsync = promisify(execFile);

/** Split a command string into argv, respecting quoted strings. */
function parseCommand(cmd: string): string[] {
    const args: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (ch === ' ' && !inSingle && !inDouble) {
            if (current) { args.push(current); current = ''; }
        } else {
            current += ch;
        }
    }
    if (current) args.push(current);
    return args;
}

/** Detect whether this is a screenshot command that will produce a file. */
function isScreenshotCommand(argv: string[]): boolean {
    return argv[0] === 'screenshot' || argv[0] === 'pdf';
}

export const browserCommandTool: Tool = {
    meta: {
        category: 'web',
        version: '1.0.0',
        permission: 'dangerous',
    },
    declaration: {
        name: 'browser_command',
        description:
            'Control a real Chrome browser using the agent-browser CLI. ' +
            'Supports navigation, element interaction, accessibility snapshots, screenshots, JS eval, cookies, tabs, and more. ' +
            '\n\nTypical AI workflow:\n' +
            '1. `open <url>` — navigate to a page\n' +
            '2. `snapshot -i --json` — get interactive elements with refs (@e1, @e2, …)\n' +
            '3. `click @e1` / `fill @e2 "text"` — interact using refs\n' +
            '4. Re-snapshot after page changes\n' +
            '\nExamples of valid commands:\n' +
            '  open https://example.com\n' +
            '  snapshot -i --json\n' +
            '  click @e2\n' +
            '  fill @e3 "hello@example.com"\n' +
            '  screenshot\n' +
            '  get text @e1\n' +
            '  eval "document.title"\n' +
            '  close\n' +
            '\nDo NOT prefix with "agent-browser" — just the subcommand and its arguments.',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description:
                        'The agent-browser subcommand and arguments (without the "agent-browser" prefix). ' +
                        'Examples: "open https://example.com", "snapshot -i --json", "click @e1", "screenshot", "close"',
                },
            },
            required: ['command'],
        },
    },
    handler: async (args, _workDir, context) => {
        const rawCommand = String(args.command ?? '').trim();
        if (!rawCommand) return '[Error] command 不能为空';

        // Build --session id for isolation between users/sessions
        const sessionId =
            context?.userId && context?.sessionId
                ? `${context.userId}-${context.sessionId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
                : 'default';

        const argv = parseCommand(rawCommand);
        if (argv.length === 0) return '[Error] 无效命令';

        // For screenshot/pdf, inject a temp output path so we can read it back
        let tempScreenshotPath: string | null = null;
        const isScreenshot = isScreenshotCommand(argv);
        if (isScreenshot && argv[0] === 'screenshot') {
            // Only inject temp path if user hasn't specified one
            const hasExplicitPath = argv.slice(1).some(a => !a.startsWith('-'));
            if (!hasExplicitPath) {
                tempScreenshotPath = join(tmpdir(), `ab-${randomBytes(8).toString('hex')}.png`);
                argv.push(tempScreenshotPath);
            }
        }

        const cliArgs = ['--session', sessionId, '--json', ...argv];

        try {
            const { stdout, stderr } = await execFileAsync('agent-browser', cliArgs, {
                timeout: 60_000,
                maxBuffer: 10 * 1024 * 1024, // 10 MB
                signal: context?.signal,
            });

            const output = stdout.trim() || stderr.trim();

            // Handle screenshot: read file and push to imageCallback
            if (tempScreenshotPath && context?.imageCallback) {
                try {
                    const imgData = await readFile(tempScreenshotPath);
                    const b64 = imgData.toString('base64');
                    await context.imageCallback(b64, 'image/png', `screenshot`);
                    await unlink(tempScreenshotPath).catch(() => {});
                    // Return the JSON response without the path leaking out
                    return output || '[OK] Screenshot captured and sent';
                } catch {
                    await unlink(tempScreenshotPath).catch(() => {});
                }
            }

            return output || '[OK]';
        } catch (err: unknown) {
            if (err instanceof Error && err.message.includes('ABORT_ERR')) {
                return '[Error] 操作被取消';
            }
            const e = err as { stderr?: string; stdout?: string; message?: string; code?: number };
            const detail = e.stderr?.trim() || e.stdout?.trim() || e.message || String(err);
            return `[Error] ${detail}`;
        }
    },
};
