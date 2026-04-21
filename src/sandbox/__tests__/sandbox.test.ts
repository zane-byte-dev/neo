import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInSandbox, formatSandboxResult } from '../index.js';

vi.mock('../../utils/audit-logger.js', () => ({
    logDangerousCommand: vi.fn(),
}));

let workDir: string;

beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'sandbox-test-')); });
afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

describe('runInSandbox (host backend)', () => {
    it('captures stdout of a simple command', async () => {
        const r = await runInSandbox('echo hello-neo', { workDir, mode: 'host' });
        expect(r.exitCode).toBe(0);
        expect(r.backend).toBe('host');
        expect(r.stdout.trim()).toBe('hello-neo');
        expect(r.timedOut).toBe(false);
    });

    it('captures stderr and non-zero exit codes', async () => {
        const r = await runInSandbox('echo oops 1>&2; exit 3', { workDir, mode: 'host' });
        expect(r.exitCode).toBe(3);
        expect(r.stderr.trim()).toBe('oops');
    });

    it('enforces the timeout', async () => {
        const r = await runInSandbox('sleep 5', { workDir, mode: 'host', timeoutMs: 150 });
        expect(r.timedOut).toBe(true);
    });

    it('honors cwd = workDir', async () => {
        writeFileSync(join(workDir, 'marker.txt'), 'hi');
        const r = await runInSandbox('ls', { workDir, mode: 'host' });
        expect(r.stdout).toContain('marker.txt');
    });

    it('collects artifacts written under the output dir', async () => {
        mkdirSync(join(workDir, '.outputs'), { recursive: true });
        const r = await runInSandbox('echo hi > .outputs/hello.txt', { workDir, mode: 'host' });
        expect(r.exitCode).toBe(0);
        expect(r.artifacts?.length).toBe(1);
        expect(r.artifacts?.[0].path).toBe('.outputs/hello.txt');
    });
});

describe('formatSandboxResult', () => {
    it('shows (no output) when empty', () => {
        const s = formatSandboxResult({
            stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, backend: 'host',
        });
        expect(s).toBe('(no output)');
    });

    it('includes stderr section when present', () => {
        const s = formatSandboxResult({
            stdout: 'out', stderr: 'err', exitCode: 0, timedOut: false, durationMs: 1, backend: 'host',
        });
        expect(s).toContain('out');
        expect(s).toContain('[stderr]');
        expect(s).toContain('err');
    });

    it('shows [TIMEOUT] when timed out', () => {
        const s = formatSandboxResult({
            stdout: '', stderr: '', exitCode: null, timedOut: true, durationMs: 100, backend: 'host',
        });
        expect(s).toContain('[TIMEOUT]');
    });

    it('shows exit code for non-zero exits', () => {
        const s = formatSandboxResult({
            stdout: '', stderr: '', exitCode: 2, timedOut: false, durationMs: 1, backend: 'host',
        });
        expect(s).toContain('[exit 2]');
    });

    it('renders artifact list', () => {
        const s = formatSandboxResult({
            stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1, backend: 'host',
            artifacts: [{ path: '.outputs/plot.png', size: 2048, mimeType: 'image/png' }],
        });
        expect(s).toContain('[artifacts]');
        expect(s).toContain('.outputs/plot.png');
        expect(s).toContain('image/png');
    });
});
