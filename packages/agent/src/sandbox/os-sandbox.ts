/**
 * src/sandbox/os-sandbox.ts — OS-level filesystem sandbox (Seatbelt / bubblewrap).
 *
 * Wraps bash commands in OS kernel-enforced filesystem restrictions so that
 * write access is limited to the workspace directory and /tmp, regardless of
 * what the command string contains.  This closes the `cd && rm` escape that
 * DANGEROUS_PATTERNS regex cannot catch.
 *
 * macOS:  Uses Apple Seatbelt via `sandbox-exec -p <policy>`.
 *         Always available — no extra deps needed.
 *
 * Linux:  Uses bubblewrap (`bwrap`) with read-only bind mounts for the entire
 *         filesystem and a writable bind for workDir + /tmp.
 *         Requires `bwrap` to be installed (apt: bubblewrap).
 *
 * Set SANDBOX_OS_ISOLATION=0 to opt-out (e.g. in CI environments where the
 * kernel policies are already enforced by Docker).
 */

import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

// ── Detection ────────────────────────────────────────────────────────────────

let _bwrapAvailable: boolean | undefined;

function detectBwrap(): boolean {
    if (_bwrapAvailable !== undefined) return _bwrapAvailable;
    try {
        execSync('which bwrap', { stdio: 'ignore' });
        _bwrapAvailable = true;
    } catch {
        _bwrapAvailable = false;
    }
    return _bwrapAvailable;
}

/**
 * Returns whether OS-level filesystem isolation is available and enabled.
 * Set SANDBOX_OS_ISOLATION=0 to disable.
 */
export function isOsSandboxAvailable(): boolean {
    if (process.env.SANDBOX_OS_ISOLATION === '0') return false;
    if (process.platform === 'darwin') return true;
    if (process.platform === 'linux') return detectBwrap();
    return false;
}

// ── Spawn arg builders ───────────────────────────────────────────────────────

/**
 * Returns { cmd, args } that wrap `sh -c command` inside an OS sandbox.
 * Write access is restricted to `workDir` and system temp dirs.
 * Call only after confirming `isOsSandboxAvailable()`.
 */
export function buildOsSandboxSpawnArgs(
    command: string,
    workDir: string,
): { cmd: string; args: string[] } {
    // Resolve symlinks so OS-level path matching is accurate.
    // On macOS, /tmp → /private/tmp; Seatbelt uses real paths.
    let realWorkDir = workDir;
    try { realWorkDir = realpathSync(workDir); } catch { /* keep original */ }

    if (process.platform === 'darwin') return buildSeatbeltArgs(command, realWorkDir);
    return buildBwrapArgs(command, realWorkDir);
}

// ── macOS Seatbelt ───────────────────────────────────────────────────────────

function buildSeatbeltArgs(command: string, workDir: string): { cmd: string; args: string[] } {
    // Escape workDir for embedding in the Seatbelt policy string.
    const escapedWork = workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // macOS /tmp is a symlink to /private/tmp — include both to be safe.
    const policy = [
        '(version 1)',
        '(deny default)',

        // ── File reads: allow the entire filesystem (binaries, libs, config)
        '(allow file-read*)',

        // ── File writes: workDir + system temp only
        `(allow file-write* (subpath "${escapedWork}"))`,
        '(allow file-write* (subpath "/tmp"))',
        '(allow file-write* (subpath "/private/tmp"))',
        // Per-user caches used by macOS tools (node, python, etc.)
        '(allow file-write* (subpath "/var/folders"))',
        // stdio and /dev/null
        '(allow file-write* (literal "/dev/null"))',
        '(allow file-write-data (literal "/dev/stdout"))',
        '(allow file-write-data (literal "/dev/stderr"))',

        // ── Process operations
        '(allow process-exec*)',
        '(allow process-fork)',
        '(allow signal)',

        // ── System info queries used by most programs
        '(allow sysctl-read)',
        '(allow user-preference-read)',
        '(allow iokit-get-properties)',

        // ── Mach IPC & unix sockets (needed for launchd / inter-process calls)
        '(allow mach*)',
        '(allow network-outbound (remote unix-socket))',
        '(allow network-inbound (local unix-socket))',
    ].join('\n');

    return {
        cmd: 'sandbox-exec',
        args: ['-p', policy, 'sh', '-c', command],
    };
}

// ── Linux bubblewrap ─────────────────────────────────────────────────────────

function buildBwrapArgs(command: string, workDir: string): { cmd: string; args: string[] } {
    return {
        cmd: 'bwrap',
        args: [
            // Entire host filesystem as read-only base layer
            '--ro-bind', '/', '/',
            // workDir and /tmp are writable
            '--bind', workDir, workDir,
            '--bind', '/tmp', '/tmp',
            // Virtual filesystems required by most programs
            '--dev', '/dev',
            '--proc', '/proc',
            // Set cwd inside the sandbox
            '--chdir', workDir,
            // Kill sandbox process if Node exits
            '--die-with-parent',
            // Run the command
            'sh', '-c', command,
        ],
    };
}
