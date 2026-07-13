import { describe, expect, it } from 'vitest';
import { artifactCitations, knowledgeSearchCitations } from '../pi-chat.js';

describe('pi chat citations', () => {
    it('keeps chunks from the same document distinct by line range', () => {
        const citations = knowledgeSearchCitations({
            details: [
                { document_id: 'document:notebooks/a.md', relative_path: 'notebooks/a.md', title: 'A', line_start: 1, line_end: 10, snippet: 'first', citation: '【4】' },
                { document_id: 'document:notebooks/a.md', relative_path: 'notebooks/a.md', title: 'A', line_start: 20, line_end: 30, snippet: 'second', citation: '【7】' },
            ],
        });
        expect(citations).toHaveLength(2);
        expect(citations.map((item) => item.sourceId)).toEqual([
            'document:notebooks/a.md#L1-L10',
            'document:notebooks/a.md#L20-L30',
        ]);
        expect(citations.map((item) => item.n)).toEqual([4, 7]);
    });

    it('preserves artifact source provenance line ranges', () => {
        const citations = artifactCitations({
            details: { metadata: { sources: [{ documentId: 'document:notebooks/a.md', path: 'notebooks/a.md', lineStart: 2, lineEnd: 4, citation: 9 }] } },
        });
        expect(citations[0]).toMatchObject({ n: 9, sourceId: 'document:notebooks/a.md#L2-L4', snippet: 'notebooks/a.md:L2-L4' });
    });
});
