/**
 * src/sandbox/config.ts — Sandbox runtime configuration.
 *
 * Environment variables:
 *   SANDBOX_MODE           host | docker     (default: host)
 *   SANDBOX_IMAGE          docker image      (default: node:20-bookworm-slim)
 *   SANDBOX_MEMORY_MB      memory cap        (default: 512)
 *   SANDBOX_CPUS           cpu cap           (default: 1)
 *   SANDBOX_PIDS           pid cap           (default: 256)
 *   SANDBOX_NETWORK        none | bridge     (default: none)
 *   SANDBOX_TIMEOUT_MS     default timeout   (default: 30000)
 *   SANDBOX_MAX_TIMEOUT_MS hard timeout cap  (default: 300000)
 *   SANDBOX_READONLY       "1" mounts workspace as read-only (default: rw)
 *   SANDBOX_OUTPUT_DIR     relative subdir auto-collected as artifacts (default: .outputs)
 *   SANDBOX_OS_ISOLATION   "0" to disable OS-level filesystem isolation (default: enabled)
 *                          macOS uses Seatbelt (sandbox-exec), Linux uses bubblewrap (bwrap).
 *                          Restricts write access to workDir + /tmp at kernel level,
 *                          closing bypass paths like `cd /etc && rm file`.
 */

export type SandboxMode = 'host' | 'docker';

function envInt(key: string, fallback: number): number {
    const v = process.env[key];
    if (!v) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envNum(key: string, fallback: number): number {
    const v = process.env[key];
    if (!v) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const rawMode = (process.env.SANDBOX_MODE ?? 'host').toLowerCase();
export const SANDBOX_MODE: SandboxMode = rawMode === 'docker' ? 'docker' : 'host';
export const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? 'node:20-bookworm-slim';
export const SANDBOX_MEMORY_MB = envInt('SANDBOX_MEMORY_MB', 512);
export const SANDBOX_CPUS = envNum('SANDBOX_CPUS', 1);
export const SANDBOX_PIDS = envInt('SANDBOX_PIDS', 256);
export const SANDBOX_NETWORK = (process.env.SANDBOX_NETWORK ?? 'none').toLowerCase();
export const SANDBOX_DEFAULT_TIMEOUT_MS = envInt('SANDBOX_TIMEOUT_MS', 30_000);
export const SANDBOX_MAX_TIMEOUT_MS = envInt('SANDBOX_MAX_TIMEOUT_MS', 300_000);
export const SANDBOX_READONLY = process.env.SANDBOX_READONLY === '1';
export const SANDBOX_OUTPUT_DIR = process.env.SANDBOX_OUTPUT_DIR ?? '.outputs';
