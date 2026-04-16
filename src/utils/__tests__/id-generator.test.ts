import { describe, it, expect } from 'vitest';
import { generateId } from '../id-generator.js';

describe('generateId', () => {
    it('returns a non-empty string', () => {
        const id = generateId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('returns unique IDs on consecutive calls', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });

    it('starts with 8 hex chars followed by base36 timestamp', () => {
        const id = generateId();
        // 8 hex chars (randomBytes(4).toString('hex')) + base36 timestamp
        expect(id).toMatch(/^[0-9a-f]{8}[0-9a-z]+$/);
    });

    it('has reasonable length (typically 16-20 chars)', () => {
        const id = generateId();
        expect(id.length).toBeGreaterThanOrEqual(14);
        expect(id.length).toBeLessThanOrEqual(25);
    });
});
