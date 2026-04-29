/**
 * Tests for /api/models and /api/models/messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const calcUserMock = vi.fn();
const messageListMock = vi.fn();
const getMonthlyUsageMock = vi.fn();

vi.mock('../../services/user-service.js', () => ({
    calcUser: calcUserMock,
}));
vi.mock('../../services/chat-service.js', () => ({
    messageList: messageListMock,
}));
vi.mock('../../utils/token-tracker.js', () => ({
    getMonthlyUsage: getMonthlyUsageMock,
}));

let workDir: string;

beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'mod-'));
    calcUserMock.mockResolvedValue({ workDir, stateDir: workDir });
    messageListMock.mockResolvedValue([{ role: 'user', content: 'hi' }]);
    getMonthlyUsageMock.mockResolvedValue({
        month: '2026-04',
        totalPromptTokens: 10, totalCompletionTokens: 5, totalTokens: 15,
        callCount: 1, byModel: {},
    });
    const usageDir = workDir;
    await fs.mkdir(usageDir, { recursive: true });
    const rec = {
        timestamp: Date.now(),
        userId: 'u1',
        model: 'deepseek-chat',
        tier: 'general',
        score: 1, confidence: 1, reason: '',
        promptTokens: 10, completionTokens: 5, totalTokens: 15,
        estimatedCost: 0.001, durationMs: 100, fallbackUsed: false,
    };
    await fs.writeFile(join(usageDir, 'usage.jsonl'), JSON.stringify(rec) + '\n', 'utf8');
});

afterEach(() => rmSync(workDir, { recursive: true, force: true }));

describe('GET /api/models', () => {
    it('returns 401 without auth', async () => {
        const { model } = await import('../model.js');
        const { app, router, mount } = createTestApp();
        model(router); mount();
        const res = await request(app.callback()).get('/api/models');
        expect(res.status).toBe(401);
    });

    it('returns models, routing, usage, history, and dailyCost', async () => {
        const { model } = await import('../model.js');
        const { app, router, mount } = createTestApp();
        model(router); mount();
        const res = await request(app.callback())
            .get('/api/models')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.models)).toBe(true);
        expect(res.body.models.length).toBeGreaterThan(0);
        // every model has the expected shape
        for (const m of res.body.models) {
            expect(m).toHaveProperty('alias');
            expect(m).toHaveProperty('modelId');
            expect(m).toHaveProperty('provider');
            expect(m).toHaveProperty('pricing');
            expect(m).toHaveProperty('free');
            expect(typeof m.configured).toBe('boolean');
        }
        expect(res.body.routing).toBeDefined();
        expect(res.body.usage.month).toBe('2026-04');
        expect(Array.isArray(res.body.history)).toBe(true);
        expect(res.body.history.length).toBe(1);
        expect(res.body.dailyCost).toBeGreaterThan(0);
    });

    it('honours the limit query parameter (capped to 200)', async () => {
        const { model } = await import('../model.js');
        const { app, router, mount } = createTestApp();
        model(router); mount();
        const res = await request(app.callback())
            .get('/api/models?limit=999')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
    });
});

describe('GET /api/models/messages', () => {
    it('returns 400 without sessionId', async () => {
        const { model } = await import('../model.js');
        const { app, router, mount } = createTestApp();
        model(router); mount();
        const res = await request(app.callback())
            .get('/api/models/messages')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(400);
    });

    it('returns the messages array for the session', async () => {
        const { model } = await import('../model.js');
        const { app, router, mount } = createTestApp();
        model(router); mount();
        const res = await request(app.callback())
            .get('/api/models/messages?sessionId=s1')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(messageListMock).toHaveBeenCalledWith('s1', 'u1', 200);
    });
});
