import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordToolCall,
    getToolStats,
    resetToolStats,
    classifyOutcome,
} from '../tool-stats.js';

describe('tool-stats', () => {
    beforeEach(() => {
        resetToolStats();
    });

    describe('classifyOutcome', () => {
        it('classifies [Error] prefix as error', () => {
            expect(classifyOutcome('[Error] something failed')).toBe('error');
        });
        it('classifies [BLOCKED] prefix as blocked', () => {
            expect(classifyOutcome('[BLOCKED] dangerous command')).toBe('blocked');
        });
        it('classifies normal output as success', () => {
            expect(classifyOutcome('OK: wrote 10 chars')).toBe('success');
        });
    });

    describe('recordToolCall + getToolStats', () => {
        it('returns an empty snapshot when no calls have been recorded', () => {
            const snap = getToolStats();
            expect(snap.totalCalls).toBe(0);
            expect(snap.tools).toEqual([]);
            expect(typeof snap.startedAt).toBe('string');
        });

        it('aggregates per-tool counts and durations', () => {
            recordToolCall('bash', 'success', 10);
            recordToolCall('bash', 'success', 30);
            recordToolCall('bash', 'error', 20);
            recordToolCall('read_file', 'success', 5);

            const snap = getToolStats();
            expect(snap.totalCalls).toBe(4);
            // sorted by total desc
            expect(snap.tools[0].name).toBe('bash');
            expect(snap.tools[0].total).toBe(3);
            expect(snap.tools[0].success).toBe(2);
            expect(snap.tools[0].error).toBe(1);
            expect(snap.tools[0].blocked).toBe(0);
            expect(snap.tools[0].totalDurationMs).toBe(60);
            expect(snap.tools[0].maxDurationMs).toBe(30);
            expect(snap.tools[0].avgDurationMs).toBeCloseTo(20);
            expect(snap.tools[0].successRate).toBeCloseTo(2 / 3);
            expect(snap.tools[0].lastCalledAt).not.toBeNull();

            expect(snap.tools[1].name).toBe('read_file');
            expect(snap.tools[1].total).toBe(1);
        });

        it('tracks blocked outcomes separately', () => {
            recordToolCall('bash', 'blocked', 1);
            recordToolCall('bash', 'blocked', 2);
            const snap = getToolStats();
            expect(snap.tools[0].blocked).toBe(2);
            expect(snap.tools[0].success).toBe(0);
            expect(snap.tools[0].successRate).toBe(0);
        });
    });
});
