import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../store.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint.js';
import { checkpointFilePath } from '../paths.js';

let workDir: string;
let runId: string;

beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runtime-checkpoint-'));
    const run = await createRun(workDir, {
        userId: 'a',
        entrypoint: 'web-chat',
        triggerType: 'user_message',
    });
    runId = run.id;
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runtime checkpoint', () => {
    it('returns null before any checkpoint exists', async () => {
        expect(await loadCheckpoint(workDir, runId)).toBeNull();
    });

    it('saves and loads a checkpoint, refreshing updatedAt', async () => {
        const saved = await saveCheckpoint(workDir, {
            runId,
            updatedAt: '1970-01-01T00:00:00.000Z',
            phase: 'streaming',
            historyCursor: 4,
            partialResponse: 'partial',
        });
        // saveCheckpoint stamps a fresh updatedAt
        expect(saved.updatedAt).not.toBe('1970-01-01T00:00:00.000Z');
        expect(existsSync(checkpointFilePath(workDir, runId))).toBe(true);

        const loaded = await loadCheckpoint(workDir, runId);
        expect(loaded).toEqual(saved);
    });

    it('overwrites previous checkpoints in place', async () => {
        await saveCheckpoint(workDir, {
            runId,
            updatedAt: new Date().toISOString(),
            phase: 'preparing',
        });
        await saveCheckpoint(workDir, {
            runId,
            updatedAt: new Date().toISOString(),
            phase: 'finalizing',
            partialResponse: 'final',
            activeToolName: 'bash',
            activeToolStep: 2,
        });
        const loaded = await loadCheckpoint(workDir, runId);
        expect(loaded?.phase).toBe('finalizing');
        expect(loaded?.partialResponse).toBe('final');
        expect(loaded?.activeToolName).toBe('bash');
        expect(loaded?.activeToolStep).toBe(2);
    });
});
