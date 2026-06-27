import { describe, it, expect, beforeEach } from 'vitest';
import {
    smartTruncate,
    setToolResult,
    getToolResult,
    resetToolResultCache,
} from '../tool-result-cache.js';

describe('smartTruncate', () => {
    it('returns input unchanged when shorter than max', () => {
        const s = 'hello world';
        expect(smartTruncate(s, { max: 100 })).toBe(s);
    });

    it('keeps head and tail and reports omitted chars', () => {
        const s = 'a'.repeat(200) + 'MIDDLE' + 'b'.repeat(200);
        const out = smartTruncate(s, { max: 100, head: 50, tail: 30 });
        expect(out.startsWith('a'.repeat(50))).toBe(true);
        expect(out.endsWith('b'.repeat(30))).toBe(true);
        expect(out).toMatch(/chars omitted/);
        expect(out.length).toBeLessThan(s.length);
    });

    it('returns input as-is when head+tail >= length', () => {
        const s = 'abcdef';
        expect(smartTruncate(s, { max: 3, head: 10, tail: 10 })).toBe(s);
    });
});

describe('tool-result cache', () => {
    beforeEach(() => resetToolResultCache());

    it('stores and retrieves entries', () => {
        setToolResult('id1', { userId: 'u1', toolName: 'bash', result: 'hello' });
        const entry = getToolResult('id1');
        expect(entry?.userId).toBe('u1');
        expect(entry?.toolName).toBe('bash');
        expect(entry?.result).toBe('hello');
        expect(typeof entry?.createdAt).toBe('number');
    });

    it('returns undefined for unknown ids', () => {
        expect(getToolResult('nope')).toBeUndefined();
    });

    it('overwrites existing id (LRU refresh)', () => {
        setToolResult('id1', { userId: 'u1', toolName: 'a', result: '1' });
        setToolResult('id1', { userId: 'u1', toolName: 'a', result: '2' });
        expect(getToolResult('id1')?.result).toBe('2');
    });
});
