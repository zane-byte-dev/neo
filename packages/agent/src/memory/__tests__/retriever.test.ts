import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize.js';
import { retrieve } from '../retriever.js';
import type { MemoryItem } from '../types.js';

describe('memory/tokenize', () => {
    it('tokenizes ASCII words and filters stopwords', () => {
        expect(tokenize('the quick brown fox')).toEqual(['quick', 'brown', 'fox']);
    });

    it('produces CJK bigrams', () => {
        const t = tokenize('记忆系统升级');
        expect(t).toContain('记忆');
        expect(t).toContain('忆系');
        expect(t).toContain('统升');
    });

    it('mixes ASCII and CJK', () => {
        const t = tokenize('接入 MCP 客户端');
        expect(t).toContain('mcp');
        expect(t).toContain('客户');
    });
});

describe('memory/retriever', () => {
    const now = new Date().toISOString();
    const items: MemoryItem[] = [
        { id: 'a', tier: 'semantic', ts: now, text: '用户偏好使用 TypeScript 开发', meta: {} },
        { id: 'b', tier: 'episodic', ts: now, text: '今天讨论了向量数据库选型', meta: { sessionId: 's1', role: 'user' } },
        { id: 'c', tier: 'episodic', ts: '2020-01-01T00:00:00.000Z', text: 'TypeScript 是一门不错的语言', meta: { sessionId: 's0', role: 'assistant' } },
    ];

    it('returns ranked hits with BM25-like scores', () => {
        const hits = retrieve('TypeScript 开发', items, { topK: 3 });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].item.id).toBe('a'); // fresh semantic match wins
    });

    it('applies recency boost (old item loses to fresh item)', () => {
        const hits = retrieve('TypeScript', items, { topK: 3 });
        const ids = hits.map((h) => h.item.id);
        expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    });

    it('filters by tier', () => {
        const hits = retrieve('TypeScript', items, { tiers: ['semantic'] });
        expect(hits.every((h) => h.item.tier === 'semantic')).toBe(true);
    });

    it('returns empty on no overlap', () => {
        expect(retrieve('完全不相关的查询词汇xyz', items)).toEqual([]);
    });
});
