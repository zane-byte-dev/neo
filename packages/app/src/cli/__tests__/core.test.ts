import { describe, expect, it, vi } from 'vitest';
import { parseCliArgs, runCli } from '../core.js';
import type { CliDeps } from '../core.js';
import type { AgentRuntime } from '@neo/runtime';
import type { RunEvent } from '@neo/runtime';

describe('parseCliArgs', () => {
    it('parses options and message', () => {
        expect(parseCliArgs(['--user', 'alice', '--session', 's1', '--model', 'deepseek', '--yes', 'hello', 'world'])).toMatchObject({
            userId: 'alice',
            sessionId: 's1',
            model: 'deepseek',
            yes: true,
            message: 'hello world',
        });
    });

    it('rejects conflicting confirmation flags', () => {
        expect(() => parseCliArgs(['--yes', '--no', 'hi'])).toThrow('--yes and --no');
    });
});

describe('runCli', () => {
    it('starts a runtime run without using HTTP', async () => {
        const events: RunEvent[] = [
            {
                id: 'evt_text',
                runId: 'run1',
                index: 0,
                ts: new Date().toISOString(),
                type: 'llm_chunk',
                payload: { chunkType: 'text', text: 'hello' },
            },
            {
                id: 'evt_done',
                runId: 'run1',
                index: 1,
                ts: new Date().toISOString(),
                type: 'run_completed',
                payload: { finishedAt: new Date().toISOString(), responseLength: 5 },
            },
        ];
        let started = false;
        const runtime: AgentRuntime = {
            async startRun(input) {
                started = true;
                expect(input).toMatchObject({
                    userId: 'alice',
                    sessionId: 's1',
                    runId: 'run1',
                    message: 'hi',
                    entrypoint: 'cli',
                });
                return { runId: input.runId!, output: 'hello' };
            },
            async resumeRun() {
                throw new Error('unused');
            },
            async cancelRun() {
                throw new Error('unused');
            },
            async events(_userId, _runId, opts) {
                const after = opts?.afterIndex ?? -1;
                const next = events.filter((event) => event.index > after);
                return {
                    events: next,
                    nextCursor: next.length > 0 ? next[next.length - 1].index : after,
                };
            },
        };
        const out: string[] = [];
        const err: string[] = [];
        const deps: CliDeps = {
            runtime,
            userList: () => [{ id: 'alice', name: 'Alice' }],
            sessionGetCurrent: vi.fn(async () => ({ id: 's1' })),
            sessionCreate: vi.fn(async () => ({ id: 'created' })),
            newRunId: () => 'run1',
            readStdin: vi.fn(async () => ''),
            stdout: { write: (chunk: string | Uint8Array) => { out.push(String(chunk)); return true; } },
            stderr: { write: (chunk: string | Uint8Array) => { err.push(String(chunk)); return true; } },
        };

        await expect(runCli(['hi'], deps)).resolves.toBe(0);
        expect(started).toBe(true);
        expect(out.join('')).toContain('hello');
        expect(err.join('')).toBe('');
    });
});
