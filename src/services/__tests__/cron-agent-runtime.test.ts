import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
    users: [] as Array<{ id: string; workDir?: string; stateDir?: string }>,
    jobs: [] as Array<{ expr: string; callback: () => Promise<void> | void; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock('node-cron', () => ({
    validate: vi.fn(() => true),
    schedule: vi.fn((expr: string, callback: () => Promise<void> | void) => {
        const job = { expr, callback, stop: vi.fn() };
        state.jobs.push(job);
        return job;
    }),
}));

vi.mock('../agent-runner.js', () => ({
    runAgentTurn: vi.fn(),
}));

vi.mock('../user-service.js', () => ({
    userList: vi.fn(() => state.users),
}));

vi.mock('../refresh-now.js', () => ({
    refreshNowForAllUsers: vi.fn(async () => undefined),
}));

vi.mock('../../utils/logger.js', () => ({
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    setupLogger: vi.fn(),
}));

import { startCronAgent, stopCronAgent } from '../cron-agent.js';
import { runAgentTurn } from '../agent-runner.js';
import { createRun } from '../../runtime/store.js';
import { appendEvent } from '../../runtime/events.js';

let workDir: string;

describe('cron-agent runtime outcome delivery', () => {
    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'neo-cron-agent-'));
        mkdirSync(join(workDir, 'memory'), { recursive: true });
        writeFileSync(join(workDir, 'memory', 'schedule.json'), JSON.stringify([
            {
                id: 'morning-brief',
                cron: '*/5 * * * *',
                message: 'hello from cron',
            },
        ]), 'utf8');
        state.users = [{ id: 'alice', workDir: workDir, stateDir: workDir }];
        state.jobs = [];
        vi.clearAllMocks();
    });

    afterEach(() => {
        stopCronAgent();
        rmSync(workDir, { recursive: true, force: true });
    });

    it('runs scheduled task and produces outcome', async () => {
        vi.mocked(runAgentTurn).mockImplementation(async (opts) => {
            const runId = 'run_cron_test';
            opts.onRunCreated?.(runId);
            await createRun(workDir, {
                id: runId,
                userId: 'alice',
                entrypoint: 'cron',
                triggerType: 'scheduled_task',
                sessionId: opts.sessionId,
                request: { message: opts.message },
            });
            await appendEvent(workDir, runId, 'artifact_created', {
                artifact: {
                    id: 'art_1',
                    runId,
                    kind: 'video',
                    createdAt: new Date().toISOString(),
                    url: 'https://example.com/demo.mp4',
                    title: 'Daily clip',
                },
            });
            await appendEvent(workDir, runId, 'run_completed', {
                finishedAt: new Date().toISOString(),
                responseLength: 2,
                outputPreview: 'ok',
            });
            return 'ok';
        });

        await startCronAgent();
        const job = state.jobs.find((entry) => entry.expr === '*/5 * * * *');
        expect(job).toBeTruthy();

        await job!.callback();

        expect(runAgentTurn).toHaveBeenCalledTimes(1);
    });
});