import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createRun,
    loadRun,
    saveRun,
    updateRunStatus,
    listRunIds,
    newRunId,
} from '../store.js';
import { runDir, runFilePath } from '../paths.js';

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runtime-store-'));
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runtime store', () => {
    it('creates a run and writes run.json under .neo/runs/{id}/', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            request: { message: 'hi' },
        });

        expect(run.id).toMatch(/^run_/);
        expect(run.status).toBe('queued');
        expect(run.userId).toBe('alice');
        expect(run.createdAt).toBe(run.updatedAt);

        const onDisk = runFilePath(workDir, run.id);
        expect(existsSync(onDisk)).toBe(true);
        const parsed = JSON.parse(readFileSync(onDisk, 'utf8'));
        expect(parsed).toMatchObject({
            id: run.id,
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'queued',
            request: { message: 'hi' },
        });
        // run dir lives under .neo/runs/{id}/
        expect(runDir(workDir, run.id)).toContain('.neo');
    });

    it('honours an explicit id and initial status override', async () => {
        const run = await createRun(workDir, {
            id: 'run_custom_1',
            userId: 'bob',
            entrypoint: 'cron',
            triggerType: 'scheduled_task',
            status: 'running',
        });
        expect(run.id).toBe('run_custom_1');
        expect(run.status).toBe('running');
    });

    it('loadRun returns null for unknown ids and roundtrips otherwise', async () => {
        expect(await loadRun(workDir, 'missing')).toBeNull();
        const run = await createRun(workDir, {
            userId: 'a',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const loaded = await loadRun(workDir, run.id);
        expect(loaded).toEqual(run);
    });

    it('saveRun refreshes updatedAt without touching createdAt', async () => {
        const run = await createRun(workDir, {
            userId: 'a',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await new Promise((r) => setTimeout(r, 5));
        const next = await saveRun(workDir, { ...run, status: 'running' });
        expect(next.createdAt).toBe(run.createdAt);
        expect(next.updatedAt).not.toBe(run.updatedAt);
        expect(next.status).toBe('running');
    });

    it('updateRunStatus stamps startedAt on first running and finishedAt on terminal', async () => {
        const run = await createRun(workDir, {
            userId: 'a',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const running = await updateRunStatus(workDir, run.id, 'running');
        expect(running?.startedAt).toBeDefined();
        expect(running?.finishedAt).toBeUndefined();

        const failed = await updateRunStatus(workDir, run.id, 'failed', {
            lastError: { message: 'boom' },
        });
        expect(failed?.startedAt).toBe(running?.startedAt); // sticky
        expect(failed?.finishedAt).toBeDefined();
        expect(failed?.lastError?.message).toBe('boom');
    });

    it('updateRunStatus returns null when run does not exist', async () => {
        expect(await updateRunStatus(workDir, 'missing', 'completed')).toBeNull();
    });

    it('listRunIds returns directory entries newest first', async () => {
        const a = await createRun(workDir, {
            id: 'run_20260425_001',
            userId: 'a',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const b = await createRun(workDir, {
            id: 'run_20260425_002',
            userId: 'a',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        const ids = listRunIds(workDir);
        expect(ids).toEqual([b.id, a.id]);
    });

    it('listRunIds is empty when no runs directory exists', () => {
        expect(listRunIds(workDir)).toEqual([]);
    });

    it('newRunId yields unique ids', () => {
        const a = newRunId();
        const b = newRunId();
        expect(a).not.toBe(b);
    });
});
