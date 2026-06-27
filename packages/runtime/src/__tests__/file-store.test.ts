import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRuntimeStore } from '../file-store.js';

describe('FileRuntimeStore', () => {
    it('wraps file-backed runtime persistence behind RuntimeStore', async () => {
        const root = mkdtempSync(join(tmpdir(), 'neo-file-runtime-store-'));
        try {
            const store = new FileRuntimeStore();
            const run = await store.createRun(root, {
                userId: 'alice',
                entrypoint: 'cli',
                triggerType: 'user_message',
                request: { message: 'hi' },
            });
            await store.appendRunEvent(root, run.id, 'run_created', {
                status: 'queued',
                entrypoint: 'cli',
                triggerType: 'user_message',
            });
            await store.appendRunEvent(root, run.id, 'llm_chunk', {
                chunkType: 'text',
                text: 'hello',
            });

            expect(store.listRunIds(root)).toEqual([run.id]);
            expect((await store.loadRun(root, run.id))?.id).toBe(run.id);
            await store.saveRun(root, { ...run, status: 'running' });
            expect((await store.loadRun(root, run.id))?.status).toBe('running');
            await store.updateRunStatus(root, run.id, 'waiting_confirm', { pendingActionId: 'action_1' });
            expect((await store.loadRun(root, run.id))?.pendingActionId).toBe('action_1');
            expect(await store.lastRunEventIndex(root, run.id)).toBe(1);
            await store.pruneRunTextChunkEvents(root, run.id);
            expect(await store.listRunEvents(root, run.id, { afterIndex: -1 })).toHaveLength(1);

            await store.saveCheckpoint(root, {
                runId: run.id,
                updatedAt: 'ignored',
                phase: 'streaming',
                partialResponse: 'partial',
            });
            expect((await store.loadCheckpoint(root, run.id))?.partialResponse).toBe('partial');
            await store.deleteCheckpoint(root, run.id);
            expect(await store.loadCheckpoint(root, run.id)).toBeNull();

            const pending = await store.savePendingAction(root, {
                runId: run.id,
                type: 'tool_confirmation',
                request: { toolName: 'bash' },
            });
            expect((await store.loadPendingAction(root, run.id))?.id).toBe(pending.id);
            await store.resolvePendingAction(root, {
                runId: run.id,
                actionId: pending.id,
                status: 'approved',
                resolution: { ok: true },
            });
            expect((await store.loadPendingAction(root, run.id))?.status).toBe('approved');
            await store.clearPendingAction(root, run.id);
            expect(await store.loadPendingAction(root, run.id)).toBeNull();

            await store.saveToolApproval(root, {
                sessionId: 'session_1',
                toolName: 'bash',
                args: { command: 'ls' },
                scope: 'session',
            });
            expect(await store.matchToolApprovalScope(root, {
                sessionId: 'session_1',
                toolName: 'bash',
                args: { command: 'ls' },
            })).toBe('session');
            const approvals = await store.listToolApprovals(root);
            expect(approvals).toHaveLength(1);
            expect(await store.deleteToolApproval(root, approvals[0].id)).toBe(true);
            expect(await store.listToolApprovals(root)).toHaveLength(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
