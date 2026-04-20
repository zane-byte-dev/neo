import { describe, expect, it } from 'vitest';
import { estimateCost, isFreeModel } from '../cost.js';

describe('cost helpers', () => {
    it('estimates paid model usage cost', () => {
        const cost = estimateCost('deepseek-chat', 1000, 1000);
        expect(cost).toBeGreaterThan(0);
    });

    it('returns zero for free models', () => {
        expect(estimateCost('gemini-3-flash-preview', 2000, 2000)).toBe(0);
        expect(isFreeModel('ollama/gemma4:e4b')).toBe(true);
    });
});

