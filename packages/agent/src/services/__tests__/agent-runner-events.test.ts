import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockChat, mockWorkDir, mockStateDir } = vi.hoisted(() => ({
    mockChat: vi.fn(),
    mockWorkDir: { value: '' },
    mockStateDir: { value: '' },
}));

vi.mock('../../llm/client.js', () => {
    class MockLLMClient { chatWithContextStreaming = mockChat; }
    return { LLMClient: MockLLMClient, getToolRegistry: vi.fn(() => new Map()) };
});

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn(async () => ({
        userId: 'alice',
        workDir: mockWorkDir.value,
        workDir: mockWorkDir.value,
        stateDir: mockStateDir.value || mockWorkDir.value,
        systemInstruction: '',
        userProfile: {},
        skillRegistry: new Map(),
        userTools: new Map(),
        preferences: {},
    })),
}));

vi.mock('../../services/chat-service.js', () => ({
    sessionGet: vi.fn(async () => ({ id: 's1', title: '', start_time: '', is_current: 1, is_pinned: 0 })),
    sessionCreate: vi.fn(async () => ({ id: 's1', title: '', start_time: '', is_current: 1, is_pinned: 0 })),
    messageAdd: vi.fn(async () => undefined),
    messageList: vi.fn(async () => []),
}));

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

import { runAgentTurn } from '../agent-runner.js';
import { resumeRun } from '../agent-runner.js';
import { listRunEvents, createRun, loadRun, newRunId, saveCheckpoint, resolvePendingAction, savePendingAction } from '@neo/runtime';
import { messageAdd, messageList } from '../../services/chat-service.js';

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'neo-runner-events-'));
    mockWorkDir.value = workDir;
    mockStateDir.value = workDir;
    vi.clearAllMocks();
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

describe('runAgentTurn — runtime event emission', () => {
    it('persists the run and emits a full lifecycle event log on success', async () => {
        mockChat.mockImplementation(async (_msg: string, _hist: unknown, _ctx: unknown, onChunk: (c: unknown) => void) => {
            onChunk({ type: 'text', text: 'Hello' });
            onChunk({ type: 'tool_call', toolName: 'read_file', args: { path: '/x' } });
            onChunk({ type: 'tool_result', toolName: 'read_file', result: 'ok' });
            onChunk({ type: 'text', text: ', world!' });
            return 'Hello, world!';
        });

        const runId = newRunId();
        const out = await runAgentTurn({
            userId: 'alice',
            sessionId: 'sess1',
            message: 'hi',
            runId,
        });
        expect(out).toBe('Hello, world!');

        const run = await loadRun(workDir, runId);
        expect(run?.status).toBe('completed');
        expect(run?.metrics?.toolCallCount).toBe(1);
        expect(typeof run?.metrics?.totalDurationMs).toBe('number');

        const events = await listRunEvents(workDir, runId);
        const types = events.map((e) => e.type);
        expect(types).toContain('run_created');
        expect(types).toContain('run_started');
        expect(types).toContain('route_resolved');
        expect(types).toContain('user_message_saved');
        expect(types).toContain('tool_call_started');
        expect(types).toContain('tool_call_finished');
        expect(types).toContain('llm_chunk');
        expect(types).toContain('run_completed');

        // Indices monotonically increase.
        const indices = events.map((e) => e.index);
        for (let i = 1; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThan(indices[i - 1]);
        }
    });

    it('marks the run as failed and emits run_failed when the LLM throws', async () => {
        mockChat.mockRejectedValue(new Error('upstream blew up'));
        const runId = newRunId();
        await expect(
            runAgentTurn({
                userId: 'alice',
                sessionId: 'sess1',
                message: 'oops',
                runId,
            }),
        ).rejects.toThrow('upstream blew up');

        const run = await loadRun(workDir, runId);
        expect(run?.status).toBe('failed');
        expect(run?.lastError?.message).toContain('upstream blew up');

        const events = await listRunEvents(workDir, runId);
        expect(events.find((e) => e.type === 'run_failed')).toBeTruthy();
        expect(events.find((e) => e.type === 'run_completed')).toBeUndefined();
    });

    it('treats AbortError as cancellation rather than a hard failure', async () => {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        mockChat.mockRejectedValue(abortErr);
        const runId = newRunId();
        await expect(
            runAgentTurn({ userId: 'alice', sessionId: 'sess1', message: 'hi', runId }),
        ).rejects.toThrow('Aborted');
        const run = await loadRun(workDir, runId);
        expect(run?.status).toBe('cancelled');
    });

    it('reuses an existing run when runId already exists', async () => {
        mockChat.mockImplementation(async (_msg: string, _h: unknown, _c: unknown, onChunk: (c: unknown) => void) => {
            onChunk({ type: 'text', text: 'ok' });
            return 'ok';
        });
        const runId = newRunId();
        await runAgentTurn({ userId: 'alice', sessionId: 'sess1', message: 'first', runId });
        const eventsBefore = await listRunEvents(workDir, runId);
        const createdCountBefore = eventsBefore.filter((e) => e.type === 'run_created').length;
        expect(createdCountBefore).toBe(1);

        // Second call with the same runId should NOT re-create the run.
        await runAgentTurn({ userId: 'alice', sessionId: 'sess1', message: 'second', runId });
        const eventsAfter = await listRunEvents(workDir, runId);
        const createdCountAfter = eventsAfter.filter((e) => e.type === 'run_created').length;
        expect(createdCountAfter).toBe(1);
    });

    it('uses workDir for tool context and stateDir for run persistence when they differ', async () => {
        const workDir = mkdtempSync(join(tmpdir(), 'neo-runner-project-'));
        const stateDir = mkdtempSync(join(tmpdir(), 'neo-runner-state-'));
        mockWorkDir.value = workDir;
        mockStateDir.value = stateDir;

        try {
            mockChat.mockImplementation(async (_msg: string, _hist: unknown, ctx: { workDir: string; stateDir?: string }, onChunk: (c: unknown) => void) => {
                expect(ctx.workDir).toBe(workDir);
                expect(ctx.stateDir).toBe(stateDir);
                onChunk({ type: 'text', text: 'split roots' });
                return 'split roots';
            });

            const runId = newRunId();
            const out = await runAgentTurn({
                userId: 'alice',
                sessionId: 'sess1',
                message: 'hi',
                runId,
            });

            expect(out).toBe('split roots');
            expect(await loadRun(stateDir, runId)).toBeTruthy();
            expect(await loadRun(workDir, runId)).toBeNull();
        } finally {
            rmSync(workDir, { recursive: true, force: true });
            rmSync(stateDir, { recursive: true, force: true });
            mockWorkDir.value = workDir;
            mockStateDir.value = workDir;
        }
    });

    it('resumes an approved waiting_confirm run without re-saving the user message or replaying emitted prefix text', async () => {
        const run = await createRun(workDir, {
            id: newRunId(),
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            sessionId: 's1',
            status: 'waiting_confirm',
            request: { message: 'hi', model: 'gemma' },
        });
        await saveCheckpoint(workDir, {
            runId: run.id,
            updatedAt: new Date().toISOString(),
            phase: 'waiting_confirm',
            partialResponse: 'Hello',
        });
        const pending = await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: { toolName: 'bash', args: { command: 'echo hello' } },
        });
        await resolvePendingAction(workDir, {
            runId: run.id,
            actionId: pending.id,
            status: 'approved',
            resolution: { decidedBy: 'user' },
        });

        vi.mocked(messageList).mockResolvedValueOnce([
            { role: 'user', content: 'hi' },
        ] as never);
        const streamed: string[] = [];
        mockChat.mockImplementation(async (_msg: string, history: unknown, _ctx: unknown, onChunk: (c: unknown) => void) => {
            expect(history).toEqual([]);
            onChunk({ type: 'text', text: 'Hello' });
            onChunk({ type: 'text', text: ' world' });
            return 'Hello world';
        });

        const out = await resumeRun({
            userId: 'alice',
            runId: run.id,
            onChunk: (chunk) => {
                if (chunk.type === 'text') streamed.push(chunk.text);
            },
        });

        expect(out).toBe('Hello world');
        expect(streamed).toEqual([' world']);
        expect(vi.mocked(messageAdd)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(messageAdd)).toHaveBeenCalledWith('s1', 'alice', 'assistant', 'Hello world');

        const after = await loadRun(workDir, run.id);
        expect(after?.status).toBe('completed');
        expect(after?.pendingActionId).toBeUndefined();
    });

    it('refuses to resume when a pending action is still unresolved', async () => {
        const run = await createRun(workDir, {
            id: newRunId(),
            userId: 'alice',
            entrypoint: 'web-chat',
            triggerType: 'user_message',
            sessionId: 's1',
            status: 'waiting_confirm',
            request: { message: 'hi' },
        });
        await savePendingAction(workDir, {
            runId: run.id,
            type: 'tool_confirmation',
            request: { toolName: 'bash', args: { command: 'echo hi' } },
        });

        await expect(resumeRun({ userId: 'alice', runId: run.id })).rejects.toThrow(
            'waiting for a pending action decision',
        );
    });
});
