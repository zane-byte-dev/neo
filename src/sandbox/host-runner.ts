/**
 * src/sandbox/host-runner.ts — Host execution backend with optional OS isolation.
 *
 * Uses a dedicated process group so timeout/abort can terminate shell children
 * reliably on Linux CI.
 *
 * When OS isolation is available (macOS Seatbelt / Linux bubblewrap), commands
 * are wrapped so that write access is restricted to workDir and /tmp at the
 * kernel level — regardless of what the command string contains (closes the
 * `cd /etc && rm` bypass that regex-only filtering cannot catch).
 *
 * Set SANDBOX_OS_ISOLATION=0 to opt-out (e.g. inside Docker where the outer
 * container already provides isolation).
 */

import { spawn } from 'node:child_process';
import { log } from '../utils/logger.js';
import { SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS } from './config.js';
import { buildOsSandboxSpawnArgs, isOsSandboxAvailable } from './os-sandbox.js';
import type { SandboxResult, SandboxRunOptions } from './types.js';

const FORCE_KILL_AFTER_MS = 500;

function killCommand(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
    const pid = proc.pid;
    try {
        if (pid && process.platform !== 'win32') {
            process.kill(-pid, signal);
            return;
        }
    } catch {
        // Fall back to killing the shell directly.
    }
    try {
        proc.kill(signal);
    } catch {
        // Ignore races with natural exit.
    }
}

export async function runOnHost(command: string, opts: SandboxRunOptions): Promise<SandboxResult> {
    const timeoutMs = Math.min(opts.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
    const startedAt = Date.now();

    const useOsSandbox = isOsSandboxAvailable();
    const spawnTarget = useOsSandbox
        ? buildOsSandboxSpawnArgs(command, opts.workDir)
        : { cmd: 'sh', args: ['-c', command] };

    if (useOsSandbox) {
        log.debug('sandbox', `OS isolation active (${process.platform === 'darwin' ? 'seatbelt' : 'bwrap'})`, { workDir: opts.workDir });
    }

    return await new Promise<SandboxResult>((resolve, reject) => {
        const proc = spawn(spawnTarget.cmd, spawnTarget.args, {
            cwd: opts.workDir,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            killCommand(proc, 'SIGTERM');
            forceKillHandle = setTimeout(() => {
                killCommand(proc, 'SIGKILL');
            }, FORCE_KILL_AFTER_MS);
            forceKillHandle.unref?.();
        }, timeoutMs);
        timeoutHandle.unref?.();

        let forceKillHandle: NodeJS.Timeout | undefined;

        const onAbort = () => {
            killCommand(proc, 'SIGTERM');
            forceKillHandle = setTimeout(() => {
                killCommand(proc, 'SIGKILL');
            }, FORCE_KILL_AFTER_MS);
            forceKillHandle.unref?.();
        };

        const finish = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (forceKillHandle) clearTimeout(forceKillHandle);
            opts.signal?.removeEventListener('abort', onAbort);
            resolve({
                stdout,
                stderr,
                exitCode,
                timedOut,
                durationMs: Date.now() - startedAt,
                backend: 'host',
            });
        };

        if (opts.signal?.aborted) onAbort();
        else opts.signal?.addEventListener('abort', onAbort, { once: true });

        proc.stdout?.setEncoding('utf8');
        proc.stderr?.setEncoding('utf8');
        proc.stdout?.on('data', (chunk: string) => { stdout += chunk; });
        proc.stderr?.on('data', (chunk: string) => { stderr += chunk; });
        proc.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            if (forceKillHandle) clearTimeout(forceKillHandle);
            opts.signal?.removeEventListener('abort', onAbort);
            reject(error);
        });
        proc.once('close', (code) => {
            const exitCode = timedOut || opts.signal?.aborted ? null : (typeof code === 'number' ? code : null);
            finish(exitCode);
        });
    });
}
