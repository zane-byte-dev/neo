import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
    stateDir: '',
    workDir: '',
}));

vi.mock('@neo/agent/services/user-service.js', () => ({
    calcUser: vi.fn(async (userId: string) => ({
        userId,
        workDir: state.workDir,
        stateDir: state.stateDir,
        systemInstruction: '',
        skillRegistry: { get: vi.fn(), list: vi.fn(() => []) },
        userTools: new Map(),
    })),
}));

vi.mock('@neo/agent/app/agent-runtime.js', () => ({
    neoAgentRuntime: {
        startRun: vi.fn(),
    },
}));

let root: string;

describe('workflow service', () => {
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'neo-workflow-service-'));
        state.stateDir = root;
        state.workDir = root;
        vi.clearAllMocks();
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('runs transform steps sequentially and exposes previous output', async () => {
        const { saveWorkflow, runWorkflowById, listWorkflowRuns } = await import('../workflow-service.js');

        await saveWorkflow(root, 'daily-summary', {
            name: 'Daily summary',
            trigger: { type: 'manual' },
            steps: [
                { id: 'collect', type: 'transform', template: 'Input: {{input.message}}' },
                { id: 'final', type: 'transform', template: 'Summary: {{previous}}' },
            ],
        });

        const run = await runWorkflowById('alice', root, 'daily-summary', { message: 'hello' }, 'manual');

        expect(run.status).toBe('success');
        expect(run.output).toBe('Summary: Input: hello');
        expect(run.steps.map((step) => step.status)).toEqual(['success', 'success']);
        const [stored] = await listWorkflowRuns(root, 'daily-summary', 1);
        expect(stored.id).toBe(run.id);
        expect(stored.output).toBe('Summary: Input: hello');
    });
});
