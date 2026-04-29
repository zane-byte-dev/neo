import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import {
    estimateCost,
    isFreeModel,
    appendUsageRecord,
    getDailyCost,
    COST_PER_1K,
    type UsageRecord,
} from '../cost.js';

let workDir: string;

beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cost-test-'));
});

afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
});

function rec(over: Partial<UsageRecord>): UsageRecord {
    return {
        timestamp: Date.now(),
        userId: 'u1',
        model: 'deepseek-chat',
        tier: 'general' as UsageRecord['tier'],
        score: 0,
        confidence: 0,
        reason: 't',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        estimatedCost: 0.5,
        durationMs: 100,
        fallbackUsed: false,
        ...over,
    };
}

describe('estimateCost', () => {
    it('computes input + output cost based on COST_PER_1K', () => {
        const cost = estimateCost('deepseek-chat', 1000, 1000);
        const expected = COST_PER_1K['deepseek-chat'].input + COST_PER_1K['deepseek-chat'].output;
        expect(cost).toBeCloseTo(expected, 6);
    });

    it('returns 0 for unknown model', () => {
        expect(estimateCost('unknown-model-x', 1000, 1000)).toBe(0);
    });

    it('returns 0 for free models even with many tokens', () => {
        expect(estimateCost('gemini-3-flash-preview', 99999, 99999)).toBe(0);
    });
});

describe('isFreeModel', () => {
    it('treats unknown models as free (no pricing data)', () => {
        expect(isFreeModel('mystery')).toBe(true);
    });
    it('returns true for zero-cost models', () => {
        expect(isFreeModel('gemini-3-flash-preview')).toBe(true);
    });
    it('returns false for paid models', () => {
        expect(isFreeModel('deepseek-chat')).toBe(false);
        expect(isFreeModel('claude-opus-4-5')).toBe(false);
    });
});

describe('appendUsageRecord + getDailyCost', () => {
    it('returns 0 when no usage file exists', async () => {
        expect(await getDailyCost(workDir)).toBe(0);
    });

    it('aggregates costs only for the requested date', async () => {
        const today = Date.now();
        const yesterday = today - 24 * 3600 * 1000 - 5 * 60 * 1000;
        await appendUsageRecord(rec({ timestamp: today, estimatedCost: 0.10 }), workDir);
        await appendUsageRecord(rec({ timestamp: today, estimatedCost: 0.25 }), workDir);
        await appendUsageRecord(rec({ timestamp: yesterday, estimatedCost: 9.99 }), workDir);

        const todayKey = new Date(today).toISOString().slice(0, 10);
        const total = await getDailyCost(workDir, todayKey);
        expect(total).toBeCloseTo(0.35, 6);

        // Confirm written file contains 3 lines
        const raw = await fs.readFile(join(workDir, 'usage.jsonl'), 'utf8');
        expect(raw.trim().split('\n').length).toBe(3);
    });
});
