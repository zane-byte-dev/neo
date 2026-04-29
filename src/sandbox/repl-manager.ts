/**
 * src/sandbox/repl-manager.ts — Persistent REPL sessions (python / node).
 *
 * A session is a long-lived interpreter subprocess that preserves state across
 * `run()` calls. Code is written to stdin, followed by a sentinel marker on a
 * line by itself. Stdout/stderr are read until the marker appears.
 *
 * Backends:
 *   - host   : spawn `python3 -i -u` / `node -i` directly on the host
 *   - docker : spawn `docker exec -i <container> python3 -i -u` into a
 *              pre-started container (one per session), so the workdir + pkg
 *              environment are shared across calls.
 */

import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { log } from '../utils/logger.js';
import {
    SANDBOX_CPUS, SANDBOX_IMAGE, SANDBOX_MAX_TIMEOUT_MS, SANDBOX_MEMORY_MB,
    SANDBOX_MODE, SANDBOX_NETWORK, SANDBOX_PIDS,
} from './config.js';
import { isDockerAvailable } from './docker-runner.js';

export type ReplLanguage = 'python' | 'node';

export interface ReplRunOptions {
    userId: string;
    sessionId: string;
    language: ReplLanguage;
    code: string;
    workDir: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface ReplRunResult {
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    backend: 'host' | 'docker';
}

interface ReplSession {
    key: string;
    language: ReplLanguage;
    backend: 'host' | 'docker';
    /** Interpreter subprocess (child of `docker exec` or host `python3 -i`) */
    proc: ChildProcess;
    /** Name of the docker container backing this session (docker mode only) */
    containerName?: string;
    stdoutBuf: string;
    stderrBuf: string;
    busy: boolean;
    lastUsedAt: number;
}

const SESSIONS = new Map<string, ReplSession>();
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_REPL_TIMEOUT_MS = 60_000;

function sessionKey(userId: string, sessionId: string, lang: ReplLanguage): string {
    return `${userId}:${sessionId}:${lang}`;
}

async function startDockerReplContainer(workDir: string, language: ReplLanguage): Promise<string> {
    const name = `neo-repl-${language}-${randomUUID().slice(0, 8)}`;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    const args = [
        'run', '-d', '--rm',
        '--name', name,
        '--network', SANDBOX_NETWORK,
        '--memory', `${SANDBOX_MEMORY_MB}m`,
        '--memory-swap', `${SANDBOX_MEMORY_MB}m`,
        '--cpus', String(SANDBOX_CPUS),
        '--pids-limit', String(SANDBOX_PIDS),
        '--user', `${uid}:${gid}`,
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '-v', `${workDir}:/work:rw`,
        '-w', '/work',
        '-e', 'PYTHONUNBUFFERED=1',
        SANDBOX_IMAGE,
        'sh', '-c', 'tail -f /dev/null',
    ];
    const { execa } = await import('execa');
    const r = await execa('docker', args, { timeout: 10_000, reject: false });
    if (r.exitCode !== 0) {
        throw new Error(`Failed to start REPL container: ${r.stderr?.trim() || r.stdout?.trim()}`);
    }
    return name;
}

const PY_DRIVER = `
import sys, json, traceback
_G = {'__name__': '__main__'}
while True:
    line = sys.stdin.readline()
    if not line:
        break
    try:
        req = json.loads(line)
    except Exception:
        continue
    code = req.get('code', '')
    marker = req.get('marker', '')
    try:
        exec(compile(code, '<neo-cell>', 'exec'), _G)
    except BaseException:
        traceback.print_exc()
    sys.stdout.write(marker + '\\n'); sys.stdout.flush()
    sys.stderr.write(marker + '\\n'); sys.stderr.flush()
`;

const NODE_DRIVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const ctx = {};
const vm = require('vm');
const sandbox = vm.createContext(ctx);
rl.on('line', (line) => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    const { code = '', marker = '' } = req;
    try {
        vm.runInContext(code, sandbox, { filename: '<neo-cell>' });
    } catch (e) {
        console.error(e && e.stack ? e.stack : String(e));
    }
    process.stdout.write(marker + '\\n');
    process.stderr.write(marker + '\\n');
});
`;

function spawnInterpreter(language: ReplLanguage, backend: 'host' | 'docker', containerName?: string, workDir?: string): ChildProcess {
    const driver = language === 'python' ? PY_DRIVER : NODE_DRIVER;
    const bin = language === 'python' ? 'python3' : 'node';
    const driverArgs = language === 'python' ? ['-u', '-c', driver] : ['-e', driver];
    if (backend === 'docker' && containerName) {
        return spawn('docker', ['exec', '-i', containerName, bin, ...driverArgs], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });
    }
    return spawn(bin, driverArgs, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
}

async function getOrCreateSession(opts: ReplRunOptions): Promise<ReplSession> {
    const key = sessionKey(opts.userId, opts.sessionId, opts.language);
    const existing = SESSIONS.get(key);
    if (existing && existing.proc.exitCode === null && !existing.proc.killed) {
        return existing;
    }
    const wantDocker = SANDBOX_MODE === 'docker' && await isDockerAvailable();
    const backend: 'host' | 'docker' = wantDocker ? 'docker' : 'host';
    let containerName: string | undefined;
    if (backend === 'docker') {
        containerName = await startDockerReplContainer(opts.workDir, opts.language);
    }
    const proc = spawnInterpreter(opts.language, backend, containerName, opts.workDir);
    const session: ReplSession = {
        key, language: opts.language, backend, proc, containerName,
        stdoutBuf: '', stderrBuf: '', busy: false, lastUsedAt: Date.now(),
    };
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => { session.stdoutBuf += chunk; });
    proc.stderr?.on('data', (chunk: string) => { session.stderrBuf += chunk; });
    proc.on('exit', () => {
        SESSIONS.delete(key);
        if (session.backend === 'docker' && session.containerName) {
            void killDockerContainer(session.containerName);
        }
    });
    SESSIONS.set(key, session);
    return session;
}

async function killDockerContainer(name: string): Promise<void> {
    try {
        const { execa } = await import('execa');
        await execa('docker', ['kill', name], { timeout: 5_000, reject: false });
    } catch { /* ignore */ }
}

/**
 * Drain the interpreter output until the marker sentinel has appeared on BOTH
 * stdout and stderr (we echo it to both to flush stderr too). Returns the
 * pre-marker portion of each stream.
 */
function waitForMarker(session: ReplSession, marker: string, timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolvePromise) => {
        let resolved = false;
        const finish = (stdout: string, stderr: string, timedOut: boolean) => {
            if (resolved) return;
            resolved = true;
            clearInterval(poll);
            clearTimeout(timer);
            if (onAbort) signal?.removeEventListener('abort', onAbort);
            resolvePromise({ stdout, stderr, timedOut });
        };
        const poll = setInterval(() => {
            const idxOut = session.stdoutBuf.indexOf(marker);
            const idxErr = session.stderrBuf.indexOf(marker);
            if (idxOut >= 0 && idxErr >= 0) {
                const out = session.stdoutBuf.slice(0, idxOut);
                const err = session.stderrBuf.slice(0, idxErr);
                session.stdoutBuf = session.stdoutBuf.slice(idxOut + marker.length + 1);
                session.stderrBuf = session.stderrBuf.slice(idxErr + marker.length + 1);
                finish(out, err, false);
            }
        }, 25);
        const timer = setTimeout(() => {
            const out = session.stdoutBuf; session.stdoutBuf = '';
            const err = session.stderrBuf; session.stderrBuf = '';
            finish(out, err, true);
        }, timeoutMs);
        const onAbort = signal
            ? () => {
                const out = session.stdoutBuf; session.stdoutBuf = '';
                const err = session.stderrBuf; session.stderrBuf = '';
                finish(out, err, true);
            }
            : undefined;
        if (onAbort) signal?.addEventListener('abort', onAbort);
    });
}

export async function runInRepl(opts: ReplRunOptions): Promise<ReplRunResult> {
    const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_REPL_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
    const session = await getOrCreateSession(opts);
    if (session.busy) {
        throw new Error('REPL session is busy with a previous request; wait for it to finish.');
    }
    session.busy = true;
    try {
        // Drop any stray output accumulated since the last call.
        session.stdoutBuf = ''; session.stderrBuf = '';
        const marker = `__NEO_END_${randomUUID().slice(0, 8)}__`;
        const script = JSON.stringify({ code: opts.code, marker }) + '\n';
        const startedAt = Date.now();
        session.proc.stdin?.write(script);
        const { stdout, stderr, timedOut } = await waitForMarker(session, marker, timeoutMs, opts.signal);
        session.lastUsedAt = Date.now();
        if (timedOut) {
            // State is likely corrupted — kill the session so the next call gets a fresh one.
            await closeSession(session);
        }
        return { stdout, stderr, timedOut, durationMs: Date.now() - startedAt, backend: session.backend };
    } finally {
        session.busy = false;
    }
}

async function closeSession(session: ReplSession): Promise<void> {
    SESSIONS.delete(session.key);
    try {
        session.proc.stdin?.end();
    } catch { /* ignore */ }
    try {
        session.proc.kill('SIGKILL');
    } catch { /* ignore */ }
    if (session.backend === 'docker' && session.containerName) {
        await killDockerContainer(session.containerName);
    }
}

/** Public: close any sessions belonging to a (userId, sessionId) pair. */
export async function closeRepl(userId: string, sessionId: string): Promise<void> {
    const prefix = `${userId}:${sessionId}:`;
    await Promise.all(
        [...SESSIONS.values()]
            .filter(s => s.key.startsWith(prefix))
            .map(closeSession),
    );
}

/** Idle-session sweeper — cancelled by the caller; returns a stop fn. */
export function startIdleSweeper(): () => void {
    const h = setInterval(() => {
        const now = Date.now();
        for (const s of [...SESSIONS.values()]) {
            if (!s.busy && now - s.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
                log.info('Sandbox', `Closing idle REPL session ${s.key}`);
                void closeSession(s);
            }
        }
    }, 60_000);
    // Don't hold the event loop open.
    if (typeof h.unref === 'function') h.unref();
    return () => clearInterval(h);
}

/** For tests: number of live sessions. */
export function _activeSessionCount(): number { return SESSIONS.size; }

/** For tests: shut everything down. */
export async function _shutdownAll(): Promise<void> {
    await Promise.all([...SESSIONS.values()].map(closeSession));
}
