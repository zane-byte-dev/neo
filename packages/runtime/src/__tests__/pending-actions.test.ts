import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '../store.js';
import {
    clearPendingAction,
    expirePendingAction,
    loadPendingAction,
    resolvePendingAction,
    savePendingAction,
} from '../pending-actions.js';
import { pendingFilePath } from '../paths.js';

let workDir: string;
let runId: string;

beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runtime-pending-'));
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

describe('runtime pending actions', () => {
    it('savePendingAction persists a pending record', async () => {
        const action = await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: { toolName: 'bash', args: { command: 'rm -rf /tmp/x' } },
        });
        expect(action.status).toBe('pending');
        expect(action.id).toMatch(/^action_/);
        expect(existsSync(pendingFilePath(workDir, runId))).toBe(true);

        const loaded = await loadPendingAction(workDir, runId);
        expect(loaded).toEqual(action);
    });

    it('loadPendingAction returns null when no file exists', async () => {
        expect(await loadPendingAction(workDir, runId)).toBeNull();
    });

    it('resolvePendingAction approves a matching pending action', async () => {
        const action = await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: { toolName: 'bash' },
        });
        const resolved = await resolvePendingAction(workDir, {
            runId,
            actionId: action.id,
            status: 'approved',
            resolution: { decidedBy: 'user' },
        });
        expect(resolved?.status).toBe('approved');
        expect(resolved?.resolution).toEqual({ decidedBy: 'user' });

        // Loading it back returns the resolved record.
        const loaded = await loadPendingAction(workDir, runId);
        expect(loaded?.status).toBe('approved');
    });

    it('resolvePendingAction rejects unknown / mismatched / already-resolved actions', async () => {
        // No pending file yet.
        expect(
            await resolvePendingAction(workDir, {
                runId,
                actionId: 'nope',
                status: 'denied',
            }),
        ).toBeNull();

        const action = await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: {},
        });
        // Mismatched id.
        expect(
            await resolvePendingAction(workDir, {
                runId,
                actionId: 'wrong',
                status: 'denied',
            }),
        ).toBeNull();
        // Resolve once.
        const ok = await resolvePendingAction(workDir, {
            runId,
            actionId: action.id,
            status: 'denied',
        });
        expect(ok?.status).toBe('denied');
        // Cannot resolve twice.
        expect(
            await resolvePendingAction(workDir, {
                runId,
                actionId: action.id,
                status: 'approved',
            }),
        ).toBeNull();
    });

    it('expirePendingAction expires only when expiresAt is in the past', async () => {
        const action = await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: {},
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
        // Not yet expired.
        expect(await expirePendingAction(workDir, runId)).toBeNull();
        // Force expiry in the future.
        const expired = await expirePendingAction(
            workDir,
            runId,
            new Date(Date.parse(action.expiresAt!) + 1),
        );
        expect(expired?.status).toBe('expired');
        expect(expired?.resolution).toEqual({ reason: 'timeout' });
    });

    it('expirePendingAction returns null when no expiresAt is set', async () => {
        await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: {},
        });
        expect(await expirePendingAction(workDir, runId)).toBeNull();
    });

    it('clearPendingAction removes the file', async () => {
        await savePendingAction(workDir, {
            runId,
            type: 'tool_confirmation',
            request: {},
        });
        expect(existsSync(pendingFilePath(workDir, runId))).toBe(true);
        await clearPendingAction(workDir, runId);
        expect(existsSync(pendingFilePath(workDir, runId))).toBe(false);
        // No-op on second clear.
        await clearPendingAction(workDir, runId);
    });
});
