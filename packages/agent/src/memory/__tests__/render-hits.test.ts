import { describe, it, expect } from 'vitest';
import { renderHits } from '../manager.js';
import type { RecallHit } from '../types.js';

function hit(over: Partial<RecallHit['item']> & { score?: number }): RecallHit {
    const { score = 0.5, ...itemOver } = over;
    return {
        score,
        item: {
            id: 'x', tier: 'episodic', ts: '2026-04-27T10:00:00Z',
            text: 'sample text',
            meta: {},
            ...itemOver,
        } as RecallHit['item'],
    };
}

describe('renderHits', () => {
    it('returns empty string for no hits', () => {
        expect(renderHits([])).toBe('');
    });

    it('uses 💡 for semantic, 👤 for user, 🤖 for assistant', () => {
        const out = renderHits([
            hit({ tier: 'semantic', text: 'fact' }),
            hit({ tier: 'episodic', meta: { role: 'user' }, text: 'q' }),
            hit({ tier: 'episodic', meta: { role: 'assistant' }, text: 'a' }),
        ]);
        expect(out).toContain('💡');
        expect(out).toContain('👤');
        expect(out).toContain('🤖');
    });

    it('includes session prefix when sessionId is set', () => {
        const out = renderHits([
            hit({ meta: { sessionId: 'abcdef1234', role: 'user' }, text: 'hello' }),
        ]);
        expect(out).toContain('@abcdef'); // first 6 chars
    });

    it('truncates text to 240 chars and collapses whitespace', () => {
        const long = 'a    b\nc\t' + 'x'.repeat(300);
        const out = renderHits([hit({ text: long })]);
        expect(out).toContain('a b c');
        const line = out.split('\n')[0];
        expect(line.length).toBeLessThan(280);
    });
});
