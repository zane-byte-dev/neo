import { describe, it, expect } from 'vitest';
import { createToolLoopGuard } from '../tool-loop-guard.js';

describe('toolLoopGuard', () => {
    it('does not short-circuit when results are useful', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 5; i++) {
            expect(g.shortCircuit('search_web', { query: `q${i}` })).toBeNull();
            g.record('search_web', { query: `q${i}` }, '🔍 "q" 搜索结果:\n\n1. **Title**\n   url');
        }
    });

    it('short-circuits search_web after 3 consecutive empty results', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 3; i++) {
            expect(g.shortCircuit('search_web', { query: `q${i}` })).toBeNull();
            g.record(
                'search_web',
                { query: `q${i}` },
                '[Info] "q" 暂无搜索结果（DuckDuckGo），请换个关键词或使用 fetch_url 直接访问目标网址。',
            );
        }
        const sc = g.shortCircuit('search_web', { query: 'q4' });
        expect(sc).toMatch(/\[Stop\]/);
        expect(sc).toContain('fetch_url');
        expect(sc).toContain('q0');
    });

    it('resets streak when a successful result arrives', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 2; i++) {
            g.record('search_web', { query: `q${i}` }, '[Info] "q" 暂无搜索结果（DuckDuckGo）。');
        }
        // success result resets
        g.record('search_web', { query: 'q-good' }, '🔍 "q" 搜索结果:\n\n1. ...');
        for (let i = 0; i < 2; i++) {
            g.record('search_web', { query: `q${i + 10}` }, '[Info] "q" 暂无搜索结果（DuckDuckGo）。');
            expect(g.shortCircuit('search_web', { query: 'next' })).toBeNull();
        }
    });

    it('short-circuits fetch_url after 3 consecutive HTTP errors', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 3; i++) {
            g.record('fetch_url', { url: `https://example.com/${i}` }, '[Error] HTTP 403 — 页面拒绝访问');
        }
        const sc = g.shortCircuit('fetch_url', { url: 'https://example.com/4' });
        expect(sc).toMatch(/\[Stop\]/);
        expect(sc).toContain('不同的来源');
    });

    it('returns null for unknown tool failures', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 5; i++) {
            g.record('something_else', { x: i }, '[Error] failed');
        }
        expect(g.shortCircuit('something_else', { x: 99 })).toBeNull();
    });

    it('tracks search_web and fetch_url independently', () => {
        const g = createToolLoopGuard();
        for (let i = 0; i < 3; i++) {
            g.record('search_web', { query: `q${i}` }, '[Info] "q" 暂无搜索结果。');
        }
        // search_web should be blocked
        expect(g.shortCircuit('search_web', { query: 'x' })).toMatch(/\[Stop\]/);
        // fetch_url should still be allowed
        expect(g.shortCircuit('fetch_url', { url: 'https://example.com' })).toBeNull();
    });
});
