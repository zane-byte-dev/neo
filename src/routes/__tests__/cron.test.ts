import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const state = vi.hoisted(() => ({
    root: '',
}));

vi.mock('../../services/user-service.js', () => ({
    calcUser: vi.fn(async () => ({ workDir: state.root, stateDir: state.root })),
}));

vi.mock('../../services/cron-agent.js', () => ({
    reloadSchedules: vi.fn(async () => 0),
    runScheduledTask: vi.fn(),
}));

import { cronRoute } from '../cron.js';

const cookie = signedCookie('alice');

function buildApp() {
    const { app, router, mount } = createTestApp();
    cronRoute(router);
    mount();
    return app;
}

describe('cron routes', () => {
    beforeEach(() => {
        state.root = mkdtempSync(join(tmpdir(), 'neo-cron-routes-'));
        mkdirSync(join(state.root, 'memory'), { recursive: true });
        writeFileSync(join(state.root, 'memory', 'schedule.json'), JSON.stringify([
            { id: 'morning', cron: '0 8 * * *', message: 'brief' },
        ]), 'utf8');
        writeFileSync(join(state.root, 'memory', 'cron-runs.json'), JSON.stringify([
            {
                id: 'run_1',
                job_name: 'morning',
                status: 'success',
                started_at: 1000,
                finished_at: 1250,
                duration_ms: 250,
                error: null,
                summary: 'done',
            },
        ]), 'utf8');
        vi.clearAllMocks();
    });

    afterEach(() => {
        rmSync(state.root, { recursive: true, force: true });
    });

    it('returns last run fields for cron jobs', async () => {
        const res = await request(buildApp().callback())
            .get('/api/crons')
            .set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body[0].name).toBe('morning');
        expect(res.body[0].last_status).toBe('success');
        expect(res.body[0].last_duration_ms).toBe(250);
        expect(res.body[0].last_summary).toBe('done');
    });
});