import { describe, expect, it } from 'vitest';
import { buildKnowledgeChunks } from '../chunker.js';

describe('indexing/chunker', () => {
    it('preserves heading paths and char offsets', () => {
        const text = [
            '# Intro',
            'Alpha paragraph about retrieval.',
            '',
            '## Details',
            'Beta paragraph about TypeScript indexing.',
        ].join('\n');

        const chunks = buildKnowledgeChunks({ text, maxChars: 80, overlapChars: 20 });
        const detailChunk = chunks.find((chunk) => chunk.headingPath === 'Intro > Details');

        expect(detailChunk).toBeDefined();
        expect(text.slice(detailChunk!.charStart, detailChunk!.charEnd)).toBe(detailChunk!.text);
    });

    it('creates overlapping chunks for long sections', () => {
        const text = `# Notes\n${'A'.repeat(130)}${'B'.repeat(130)}`;
        const chunks = buildKnowledgeChunks({ text, maxChars: 120, overlapChars: 30 });

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[1].charStart).toBeLessThan(chunks[0].charEnd);
        expect(chunks[0].headingPath).toBe('Notes');
    });
});