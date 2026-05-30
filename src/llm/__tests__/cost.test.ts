import { describe, expect, it } from 'vitest';
import { estimateCost } from '../cost.js';

describe('cost helpers', () => {
    it('estimates paid model usage cost', () => {
        const cost = estimateCost('deepseek-chat', 1000, 1000);
        expect(cost).toBeGreaterThan(0);
    });

    it('returns zero for unknown model', () => {
        expect(estimateCost('unknown-model', 2000, 2000)).toBe(0);
    });
});
