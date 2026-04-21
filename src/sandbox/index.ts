/**
 * src/sandbox/index.ts — Public sandbox API.
 *
 * `runInSandbox()` dispatches to the configured backend (host|docker), applies
 * defaults, and optionally collects artifacts produced in `SANDBOX_OUTPUT_DIR`.
 */

import { promises as fs } from 'node:fs';
import { basename, extname, join, posix, relative, sep } from 'node:path';
import { log } from '../utils/logger.js';
import { SANDBOX_MODE, SANDBOX_OUTPUT_DIR } from './config.js';
import { isDockerAvailable, runInDocker } from './docker-runner.js';
import { runOnHost } from './host-runner.js';
import type { SandboxArtifact, SandboxResult, SandboxRunOptions } from './types.js';

export * from './types.js';
export { SANDBOX_MODE, SANDBOX_OUTPUT_DIR } from './config.js';

const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.html': 'text/html', '.htm': 'text/html',
    '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

async function snapshotOutputs(workDir: string): Promise<Map<string, number>> {
    const root = join(workDir, SANDBOX_OUTPUT_DIR);
    const snap = new Map<string, number>();
    try {
        await walk(root, root, snap);
    } catch {
        // Directory doesn't exist yet — fine.
    }
    return snap;
}

async function walk(root: string, dir: string, out: Map<string, number>): Promise<void> {
    let entries: import('node:fs').Dirent[] = [];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
            await walk(root, abs, out);
        } else if (e.isFile()) {
            try {
                const st = await fs.stat(abs);
                out.set(relative(root, abs), st.mtimeMs);
            } catch { /* ignore */ }
        }
    }
}

async function diffArtifacts(workDir: string, before: Map<string, number>): Promise<SandboxArtifact[]> {
    const after = await snapshotOutputs(workDir);
    const items: SandboxArtifact[] = [];
    for (const [rel, mtime] of after) {
        if (before.get(rel) === mtime) continue;
        const abs = join(workDir, SANDBOX_OUTPUT_DIR, rel);
        try {
            const st = await fs.stat(abs);
            const ext = extname(rel).toLowerCase();
            items.push({
                path: posix.join(SANDBOX_OUTPUT_DIR, rel.split(sep).join('/')),
                size: st.size,
                mimeType: MIME_BY_EXT[ext] ?? undefined,
            });
        } catch { /* ignore */ }
    }
    return items;
}

/** Choose a backend per call: explicit > global > availability. */
async function pickBackend(opts: SandboxRunOptions): Promise<'host' | 'docker'> {
    const requested = opts.mode ?? SANDBOX_MODE;
    if (requested === 'docker') {
        if (await isDockerAvailable()) return 'docker';
        log.warn('Sandbox', 'SANDBOX_MODE=docker but docker CLI is unavailable, falling back to host');
        return 'host';
    }
    return 'host';
}

export async function runInSandbox(command: string, opts: SandboxRunOptions): Promise<SandboxResult> {
    const backend = await pickBackend(opts);
    const before = await snapshotOutputs(opts.workDir);
    const result = backend === 'docker' ? await runInDocker(command, opts) : await runOnHost(command, opts);
    const artifacts = await diffArtifacts(opts.workDir, before);
    if (artifacts.length) result.artifacts = artifacts;
    return result;
}

/**
 * Format a sandbox result into the plain-text string the agent / LLM sees.
 * Combines stdout + stderr + timeout / exit info + artifact references.
 */
export function formatSandboxResult(r: SandboxResult): string {
    const parts: string[] = [];
    const stdout = r.stdout.trim();
    const stderr = r.stderr.trim();
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(`[stderr]\n${stderr}`);
    if (r.timedOut) {
        parts.push(`[TIMEOUT] Command exceeded the time limit (${r.durationMs}ms).`);
    } else if (r.exitCode !== 0 && r.exitCode !== null) {
        parts.push(`[exit ${r.exitCode}]`);
    }
    if (r.artifacts?.length) {
        const lines = r.artifacts.map(a => {
            const size = a.size > 1024 ? `${(a.size / 1024).toFixed(1)}KiB` : `${a.size}B`;
            const mt = a.mimeType ? ` · ${a.mimeType}` : '';
            return `  - ${a.path} (${size}${mt})`;
        });
        parts.push(`[artifacts]\n${lines.join('\n')}`);
    }
    return parts.join('\n').trim() || '(no output)';
}

/** For a compact single-word label in logs/UX. */
export function describeSandbox(): string {
    return `${SANDBOX_MODE}${SANDBOX_MODE === 'docker' ? ' (docker)' : ''}`;
}

/** Expose a lightweight util so the output-dir path is consistent everywhere. */
export function outputDirName(): string { return SANDBOX_OUTPUT_DIR; }

/** Strip noise so a small result-preview doesn't include huge artifact files. */
export function clipArtifactBasename(name: string): string {
    return basename(name);
}
