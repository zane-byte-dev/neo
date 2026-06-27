import { describe, it, expect, afterAll } from 'vitest';
import { runInRepl, _shutdownAll, _activeSessionCount } from '../repl-manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workDir = mkdtempSync(join(tmpdir(), 'repl-test-'));

afterAll(async () => {
    await _shutdownAll();
    rmSync(workDir, { recursive: true, force: true });
});

describe('runInRepl (python, host backend)', () => {
    it('executes simple code and returns stdout', async () => {
        const r = await runInRepl({
            userId: 'u1', sessionId: 's1', language: 'python',
            code: 'print(1 + 2)', workDir, timeoutMs: 10_000,
        });
        expect(r.backend).toBe('host');
        expect(r.stdout).toContain('3');
        expect(r.timedOut).toBe(false);
    });

    it('preserves variable state across calls in the same session', async () => {
        await runInRepl({
            userId: 'u1', sessionId: 's1', language: 'python',
            code: 'x = 42', workDir, timeoutMs: 10_000,
        });
        const r = await runInRepl({
            userId: 'u1', sessionId: 's1', language: 'python',
            code: 'print(x * 2)', workDir, timeoutMs: 10_000,
        });
        expect(r.stdout).toContain('84');
    });

    it('isolates different sessions', async () => {
        await runInRepl({
            userId: 'u1', sessionId: 's1', language: 'python',
            code: 'secret = "aaa"', workDir, timeoutMs: 10_000,
        });
        const r = await runInRepl({
            userId: 'u2', sessionId: 's2', language: 'python',
            code: 'try:\n    print(secret)\nexcept NameError:\n    print("undefined")', workDir, timeoutMs: 10_000,
        });
        expect(r.stdout).toContain('undefined');
    });

    it('returns stderr on exceptions', async () => {
        const r = await runInRepl({
            userId: 'u3', sessionId: 's3', language: 'python',
            code: 'raise ValueError("boom")', workDir, timeoutMs: 10_000,
        });
        expect(r.stderr).toMatch(/ValueError/);
    });

    it('times out and resets the session on runaway code', async () => {
        const before = _activeSessionCount();
        const r = await runInRepl({
            userId: 'u4', sessionId: 's4', language: 'python',
            code: 'import time; time.sleep(5)', workDir, timeoutMs: 200,
        });
        expect(r.timedOut).toBe(true);
        // After timeout, the session is killed; count should not grow beyond expected.
        expect(_activeSessionCount()).toBeLessThanOrEqual(before + 1);
    });
});
