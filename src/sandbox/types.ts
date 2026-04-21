/**
 * src/sandbox/types.ts — Public sandbox types.
 */

export type SandboxLanguage = 'bash' | 'python' | 'node';

export interface SandboxRunOptions {
    /** Working directory that is mounted / used as cwd */
    workDir: string;
    /** Timeout in ms; clamped by SANDBOX_MAX_TIMEOUT_MS */
    timeoutMs?: number;
    /** Override global read-only setting for this run */
    readonly?: boolean;
    /** Caller-supplied abort signal (disconnect, user stop) */
    signal?: AbortSignal;
    /** Force mode for this call (mainly for tests) */
    mode?: 'host' | 'docker';
}

export interface SandboxArtifact {
    /** Path relative to workDir (always forward slashes) */
    path: string;
    /** Size in bytes */
    size: number;
    /** Best-effort mime type (sniffed from extension) */
    mimeType?: string;
}

export interface SandboxResult {
    stdout: string;
    stderr: string;
    /** Exit code; null if timed-out/killed before completion */
    exitCode: number | null;
    /** True when the run hit the timeout */
    timedOut: boolean;
    /** Wall-clock duration in ms */
    durationMs: number;
    /** Backend that actually executed the call */
    backend: 'host' | 'docker';
    /** Files that appeared in SANDBOX_OUTPUT_DIR after the run */
    artifacts?: SandboxArtifact[];
}
