/**
 * src/sandbox/docker-runner.ts — Docker CLI backend.
 *
 * Each call spawns `docker run --rm ...` with:
 *   - workDir mounted at /work (rw by default, ro when requested)
 *   - resource caps from SANDBOX_* env
 *   - network disabled by default
 *   - non-root user via --user to avoid writing as root on the host
 *
 * Uses the plain docker CLI instead of a library — zero new deps.
 */

import { execa } from 'execa';
import {
    SANDBOX_CPUS, SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_IMAGE, SANDBOX_MAX_TIMEOUT_MS,
    SANDBOX_MEMORY_MB, SANDBOX_NETWORK, SANDBOX_PIDS, SANDBOX_READONLY,
} from './config.js';
import type { SandboxResult, SandboxRunOptions } from './types.js';

let dockerChecked = false;
let dockerAvailable = false;

/** Returns true iff the `docker` CLI can talk to a daemon. Cached. */
export async function isDockerAvailable(): Promise<boolean> {
    if (dockerChecked) return dockerAvailable;
    dockerChecked = true;
    try {
        const r = await execa('docker', ['version', '--format', '{{.Server.Version}}'], {
            reject: false,
            timeout: 3_000,
        });
        dockerAvailable = r.exitCode === 0 && !!r.stdout?.trim();
    } catch {
        dockerAvailable = false;
    }
    return dockerAvailable;
}

export function buildDockerRunArgs(opts: { workDir: string; readonly: boolean; image?: string; }): string[] {
    const mountFlag = opts.readonly ? 'ro' : 'rw';
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    return [
        'run', '--rm', '-i',
        '--network', SANDBOX_NETWORK,
        '--memory', `${SANDBOX_MEMORY_MB}m`,
        '--memory-swap', `${SANDBOX_MEMORY_MB}m`,
        '--cpus', String(SANDBOX_CPUS),
        '--pids-limit', String(SANDBOX_PIDS),
        '--user', `${uid}:${gid}`,
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '-v', `${opts.workDir}:/work:${mountFlag}`,
        '-w', '/work',
        opts.image ?? SANDBOX_IMAGE,
    ];
}

export async function runInDocker(command: string, opts: SandboxRunOptions): Promise<SandboxResult> {
    const timeoutMs = Math.min(opts.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
    const readonly = opts.readonly ?? SANDBOX_READONLY;
    const args = [...buildDockerRunArgs({ workDir: opts.workDir, readonly }), 'sh', '-c', command];
    const startedAt = Date.now();
    const proc = await execa('docker', args, {
        reject: false,
        timeout: timeoutMs,
        cancelSignal: opts.signal,
    });
    return {
        stdout: proc.stdout ?? '',
        stderr: proc.stderr ?? '',
        exitCode: typeof proc.exitCode === 'number' ? proc.exitCode : null,
        timedOut: Boolean(proc.timedOut),
        durationMs: Date.now() - startedAt,
        backend: 'docker',
    };
}
