import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../store.js';
import { appendEvent, lastEventIndex, listRunEvents } from '../events.js';

let workDir: string;
let runId: string;

beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runtime-events-'));
    const run = await createRun(workDir, {
        userId: 'alice',
        entrypoint: 'web-chat',
        triggerType: 'user_message',
    });
    runId = run.id;
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runtime events', () => {
    it('returns an empty list before any event is written', async () => {
        expect(await listRunEvents(workDir, runId)).toEqual([]);
        expect(await lastEventIndex(workDir, runId)).toBe(-1);
    });

    it('appends events with monotonically increasing indices', async () => {
        const e0 = await appendEvent(workDir, runId, 'run_created', {
            status: 'queued',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const e1 = await appendEvent(workDir, runId, 'run_started', {
            startedAt: new Date().toISOString(),
        });
        expect(e0.index).toBe(0);
        expect(e1.index).toBe(1);
        expect(e0.runId).toBe(runId);

        const all = await listRunEvents(workDir, runId);
        expect(all.map((e) => e.type)).toEqual(['run_created', 'run_started']);
        expect(await lastEventIndex(workDir, runId)).toBe(1);
    });

    it('respects the afterIndex cursor', async () => {
        await appendEvent(workDir, runId, 'run_created', {
            status: 'queued',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await appendEvent(workDir, runId, 'llm_chunk', { chunkType: 'text', text: 'hello' });
        await appendEvent(workDir, runId, 'llm_chunk', { chunkType: 'text', text: ' world' });

        const tail = await listRunEvents(workDir, runId, { afterIndex: 0 });
        expect(tail.map((e) => e.index)).toEqual([1, 2]);

        const limited = await listRunEvents(workDir, runId, { afterIndex: 0, limit: 1 });
        expect(limited.map((e) => e.index)).toEqual([1]);
    });

    it('survives malformed lines in the log', async () => {
        const { eventsFilePath } = await import('../paths.js');
        const { appendFileSync } = await import('node:fs');
        await appendEvent(workDir, runId, 'run_created', {
            status: 'queued',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        appendFileSync(eventsFilePath(workDir, runId), 'this is not json\n');
        await appendEvent(workDir, runId, 'run_started', {
            startedAt: new Date().toISOString(),
        });
        const events = await listRunEvents(workDir, runId);
        expect(events.map((e) => e.type)).toEqual(['run_created', 'run_started']);
        // Indices remain gapless because peekNextIndex skips malformed lines.
        expect(events.map((e) => e.index)).toEqual([0, 1]);
    });

    it('preserves order under concurrent appendEvent calls', async () => {
        const ops: Promise<unknown>[] = [];
        for (let i = 0; i < 25; i++) {
            ops.push(
                appendEvent(workDir, runId, 'llm_chunk', {
                    chunkType: 'text',
                    text: `chunk-${i}`,
                }),
            );
        }
        await Promise.all(ops);
        const events = await listRunEvents(workDir, runId);
        expect(events).toHaveLength(25);
        // Indices must be a contiguous 0..24 sequence in file order.
        expect(events.map((e) => e.index)).toEqual(
            Array.from({ length: 25 }, (_, i) => i),
        );
    });

    it('events written by an earlier process can be read after a fresh import', async () => {
        // Simulate a "process restart" by re-importing the module after writes.
        await appendEvent(workDir, runId, 'run_created', {
            status: 'queued',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await appendEvent(workDir, runId, 'run_completed', {
            finishedAt: new Date().toISOString(),
            responseLength: 0,
        });
        // No in-memory state should be required; reload from disk.
        const fresh = await import('../events.js?fresh=1');
        const loaded = await fresh.listRunEvents(workDir, runId);
        expect(loaded.map((e) => e.type)).toEqual(['run_created', 'run_completed']);
    });
});
