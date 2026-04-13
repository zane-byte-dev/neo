/**
 * src/tools/user-tools/runner.ts — Execute user-defined tool scripts via subprocess.
 *
 * Scripts communicate via stdin (JSON input) / stdout (JSON output).
 * Supports Python, Node.js, and shell scripts.
 */

import { execa } from 'execa';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { ToolContext } from '../../llm/types.js';

export interface ScriptResult {
    type: 'text' | 'image' | 'error';
    content?: string;
    data?: string;       // base64 image data
    mimeType?: string;
    caption?: string;
}

const RUNTIME_COMMANDS: Record<string, (scriptPath: string) => [string, string[]]> = {
    python:  (p) => ['python3', [p]],
    node:    (p) => ['node', [p]],
    shell:   (p) => ['sh', [p]],
};

/**
 * Detect runtime from the run.* filename extension.
 */
function detectRuntime(filename: string): string {
    if (filename.endsWith('.py'))  return 'python';
    if (filename.endsWith('.ts') || filename.endsWith('.js'))  return 'node';
    if (filename.endsWith('.sh'))  return 'shell';
    return 'shell';
}

/**
 * Find the run script in a tool directory.
 */
export async function findRunScript(toolDir: string): Promise<string | null> {
    const candidates = ['run.py', 'run.ts', 'run.js', 'run.sh'];
    for (const name of candidates) {
        const p = join(toolDir, name);
        try {
            await fs.access(p);
            return p;
        } catch { /* next */ }
    }
    return null;
}

/**
 * Execute a user tool script with the given arguments and context.
 */
export async function runToolScript(
    toolDir: string,
    scriptPath: string,
    args: Record<string, unknown>,
    context: ToolContext,
    options?: { timeout?: number; env?: string[] },
): Promise<ScriptResult> {
    const runtime = detectRuntime(scriptPath);
    const [cmd, cmdArgs] = RUNTIME_COMMANDS[runtime](scriptPath);
    const timeout = options?.timeout ?? 60_000;

    // Build env: inherit process.env + selectively expose configured vars
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    // Always expose these context vars
    env['TOOL_USER_ID'] = context.userId;
    env['TOOL_SESSION_ID'] = context.sessionId;
    env['TOOL_WORK_DIR'] = context.workDir;

    // Expose explicitly listed env vars (they come from process.env)
    if (options?.env) {
        for (const key of options.env) {
            if (process.env[key]) {
                env[key] = process.env[key]!;
            }
        }
    }

    const input = JSON.stringify({
        args,
        context: {
            userId: context.userId,
            sessionId: context.sessionId,
            workDir: context.workDir,
        },
    });

    try {
        const proc = await execa(cmd, cmdArgs, {
            cwd: toolDir,
            timeout,
            input,
            reject: false,
            env,
        });

        if (proc.exitCode !== 0) {
            const errMsg = proc.stderr?.trim() || proc.stdout?.trim() || `Process exited with code ${proc.exitCode}`;
            return { type: 'error', content: errMsg.slice(0, 2000) };
        }

        const stdout = proc.stdout?.trim();
        if (!stdout) {
            return { type: 'text', content: '(no output)' };
        }

        try {
            const result = JSON.parse(stdout) as ScriptResult;
            if (!result.type) result.type = 'text';
            return result;
        } catch {
            // Script returned plain text, not JSON
            return { type: 'text', content: stdout };
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { type: 'error', content: `Script execution failed: ${msg}` };
    }
}
