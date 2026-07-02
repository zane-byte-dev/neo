import { describe, expect, it, vi } from 'vitest';
import { runRepl } from '../repl.js';
import type { ReplDeps } from '../repl.js';
import type { AgentRuntime, RunEvent } from '@neo/runtime';

function makeEvents(runId: string, text: string): RunEvent[] {
    return [
        {
            id: `${runId}_text`,
            runId,
            index: 0,
            ts: new Date().toISOString(),
            type: 'llm_chunk',
            payload: { chunkType: 'text', text },
        },
        {
            id: `${runId}_done`,
            runId,
            index: 1,
            ts: new Date().toISOString(),
            type: 'run_completed',
            payload: { finishedAt: new Date().toISOString(), responseLength: text.length },
        },
    ];
}

function makeRuntime(replies: Record<string, string>): AgentRuntime {
    return {
        async startRun(input) {
            return { runId: input.runId!, output: replies[input.runId!] ?? '' };
        },
        async resumeRun() {
            throw new Error('unused');
        },
        async cancelRun() {
            throw new Error('unused');
        },
        async events(_userId, runId, opts) {
            const all = makeEvents(runId, replies[runId] ?? '');
            const after = opts?.afterIndex ?? -1;
            const next = all.filter((event) => event.index > after);
            return { events: next, nextCursor: next.length > 0 ? next[next.length - 1].index : after };
        },
    };
}

function makeDeps(lines: (string | null)[], runtime: AgentRuntime) {
    const out: string[] = [];
    const err: string[] = [];
    const queue = [...lines];
    let runCounter = 0;
    const deps: ReplDeps = {
        runtime,
        userList: () => [{ id: 'alice', name: 'Alice' }],
        sessionCreate: vi.fn(async () => ({ id: `sess${Math.random().toString(36).slice(2, 6)}` })),
        newRunId: () => `run${++runCounter}`,
        readLine: vi.fn(async () => (queue.length ? queue.shift()! : null)),
        confirm: vi.fn(async () => false),
        stdout: { write: (chunk: string | Uint8Array) => { out.push(String(chunk)); return true; } },
        stderr: { write: (chunk: string | Uint8Array) => { err.push(String(chunk)); return true; } },
    };
    return { deps, out, err };
}

describe('runRepl', () => {
    it('streams assistant replies across multiple turns', async () => {
        const runtime = makeRuntime({ run1: 'hello', run2: 'world' });
        const { deps, out } = makeDeps(['hi', 'again', null], runtime);

        await expect(runRepl(deps)).resolves.toBe(0);

        const text = out.join('');
        expect(text).toContain('hello');
        expect(text).toContain('world');
        expect(text).toContain('Bye.');
    });

    it('exits on /exit and creates a session at startup', async () => {
        const runtime = makeRuntime({});
        const { deps } = makeDeps(['/exit'], runtime);

        await expect(runRepl(deps)).resolves.toBe(0);
        expect(deps.sessionCreate).toHaveBeenCalledTimes(1);
    });

    it('starts a fresh session on /new', async () => {
        const runtime = makeRuntime({});
        const { deps, out } = makeDeps(['/new', '/exit'], runtime);

        await expect(runRepl(deps)).resolves.toBe(0);
        expect(deps.sessionCreate).toHaveBeenCalledTimes(2);
        expect(out.join('')).toContain('Started new session');
    });

    it('reports when no user is configured', async () => {
        const runtime = makeRuntime({});
        const { deps, err } = makeDeps(['hi'], runtime);
        deps.userList = () => [];

        await expect(runRepl(deps)).resolves.toBe(2);
        expect(err.join('')).toContain('No configured user');
    });
});
