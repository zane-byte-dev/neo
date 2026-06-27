import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    sweepUserWorkspace,
    sweepAllUserWorkspaces,
} from '../sweeper.js';
import { createRun, loadRun } from '../store.js';
import { savePendingAction, loadPendingAction } from '../pending-actions.js';
import { listRunEvents } from '../events.js';

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runtime-sweeper-'));
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runtime sweeper', () => {
    it('expires pending actions whose deadline has passed', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: {},
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });

        const result = await sweepUserWorkspace(workDir, 'alice');
        expect(result.expiredPendingActions).toBe(1);
        const after = await loadPendingAction(workDir, run.id);
        expect(after?.status).toBe('expired');
    });

    it('does not expire pending actions whose deadline is in the future', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: {},
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        const result = await sweepUserWorkspace(workDir, 'alice');
        expect(result.expiredPendingActions).toBe(0);
        const after = await loadPendingAction(workDir, run.id);
        expect(after?.status).toBe('pending');
    });

    it('marks orphan running runs idle longer than 5 minutes as failed', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'running',
        });

        // Sweep in the future, well past the 5-minute idle threshold.
        const now = new Date(Date.parse(run.updatedAt) + 6 * 60 * 1000);
        const result = await sweepUserWorkspace(workDir, 'alice', now);
        expect(result.orphanedRuns).toBe(1);
        const after = await loadRun(workDir, run.id);
        expect(after?.status).toBe('failed');
        expect(after?.lastError?.message).toContain('process_restart');

        // A run_failed event should have been appended.
        const events = await listRunEvents(workDir, run.id);
        expect(events.find((e) => e.type === 'run_failed')).toBeTruthy();
    });

    it('leaves recently-running runs alone', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'running',
        });
        const result = await sweepUserWorkspace(workDir, 'alice');
        expect(result.orphanedRuns).toBe(0);
        const after = await loadRun(workDir, run.id);
        expect(after?.status).toBe('running');
    });

    it('expires idle waiting_confirm runs', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'waiting_confirm',
        });
        const now = new Date(Date.parse(run.updatedAt) + 6 * 60 * 1000);
        const result = await sweepUserWorkspace(workDir, 'alice', now);
        expect(result.expiredRuns).toBe(1);
        const after = await loadRun(workDir, run.id);
        expect(after?.status).toBe('expired');
    });

    it('expires pending confirm state and appends recovery events for stale waiting_confirm runs', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'waiting_confirm',
        });
        await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: { toolName: 'bash' },
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
        });

        const now = new Date(Date.parse(run.updatedAt) + 6 * 60 * 1000);
        const result = await sweepUserWorkspace(workDir, 'alice', now);
        expect(result.expiredPendingActions).toBe(1);
        expect(result.expiredRuns).toBe(1);

        const pending = await loadPendingAction(workDir, run.id);
        expect(pending?.status).toBe('expired');

        const after = await loadRun(workDir, run.id);
        expect(after?.status).toBe('expired');

        const events = await listRunEvents(workDir, run.id);
        expect(events.find((e) => e.type === 'confirm_resolved')).toBeTruthy();
        expect(events.find((e) => e.type === 'run_failed')).toBeTruthy();
    });

    it('skips runs that belong to a different user', async () => {
        await createRun(workDir, {
            userId: 'bob',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            status: 'running',
        });
        const result = await sweepUserWorkspace(workDir, 'alice');
        expect(result.orphanedRuns).toBe(0);
    });

    it('sweepAllUserWorkspaces aggregates per user without throwing on errors', async () => {
        // Provide one valid workspace + one with a bogus dir.
        const bogus = join(workDir, 'does-not-exist');
        const results = await sweepAllUserWorkspaces([
            { userId: 'alice', workDir },
            { userId: 'ghost', workDir: bogus },
        ]);
        // Bogus workspace yields 0 ids, so result is empty but no error.
        expect(results).toHaveLength(2);
        expect(results[0].userId).toBe('alice');
        expect(results[1].userId).toBe('ghost');
    });

    it('ignores corrupt run.json files', async () => {
        const run = await createRun(workDir, {
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
        });
        // Corrupt the file.
        writeFileSync(join(workDir, 'runs', run.id, 'run.json'), 'not-json');
        const result = await sweepUserWorkspace(workDir, 'alice');
        expect(result.orphanedRuns).toBe(0);
    });
});
