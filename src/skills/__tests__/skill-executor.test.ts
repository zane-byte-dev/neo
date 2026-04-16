import { describe, it, expect } from 'vitest';
import { interpolate } from '../skill-executor.js';

describe('interpolate', () => {
    it('replaces a single {{param}} placeholder', () => {
        expect(interpolate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
    });

    it('replaces multiple different placeholders', () => {
        const result = interpolate('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Neo' });
        expect(result).toBe('Hi Neo!');
    });

    it('replaces the same placeholder multiple times', () => {
        const result = interpolate('{{x}} and {{x}}', { x: 'val' });
        expect(result).toBe('val and val');
    });

    it('preserves unknown placeholders', () => {
        expect(interpolate('{{known}} {{unknown}}', { known: 'yes' })).toBe('yes {{unknown}}');
    });

    it('returns template unchanged when args is empty', () => {
        expect(interpolate('{{a}} {{b}}', {})).toBe('{{a}} {{b}}');
    });

    it('replaces null value with empty string', () => {
        expect(interpolate('Hello {{name}}', { name: null })).toBe('Hello ');
    });

    it('replaces undefined value with empty string', () => {
        expect(interpolate('Hello {{name}}', { name: undefined })).toBe('Hello ');
    });

    it('converts non-string values to string', () => {
        expect(interpolate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
    });

    it('handles template with no placeholders', () => {
        expect(interpolate('plain text', { any: 'val' })).toBe('plain text');
    });

    it('handles empty template', () => {
        expect(interpolate('', { any: 'val' })).toBe('');
    });
});
