/**
 * src/sandbox/host-runner.ts — Legacy "run on host" backend.
 *
 * Uses execa with a timeout. No filesystem isolation — relies on the existing
 * DANGEROUS_PATTERNS regex (applied at the bash-tool layer) for basic safety.
 */

import { execa } from 'execa';
import { SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS } from './config.js';
import type { SandboxResult, SandboxRunOptions } from './types.js';

export async function runOnHost(command: string, opts: SandboxRunOptions): Promise<SandboxResult> {
    const timeoutMs = Math.min(opts.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
    const startedAt = Date.now();
    const proc = await execa('sh', ['-c', command], {
        cwd: opts.workDir,
        timeout: timeoutMs,
        forceKillAfterDelay: 500,
        reject: false,
        all: false,
        cancelSignal: opts.signal,
    });
    return {
        stdout: proc.stdout ?? '',
        stderr: proc.stderr ?? '',
        exitCode: typeof proc.exitCode === 'number' ? proc.exitCode : null,
        timedOut: Boolean(proc.timedOut),
        durationMs: Date.now() - startedAt,
        backend: 'host',
    };
}
