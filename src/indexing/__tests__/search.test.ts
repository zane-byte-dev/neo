import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeKnowledgeDb } from '../db.js';
import { searchKnowledge } from '../search.js';
import { upsertNotebookNoteIndex, upsertNotebookSourceIndex } from '../writers.js';

describe('indexing/search', () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'neo-index-search-'));
    });

    afterEach(async () => {
        closeKnowledgeDb(workDir);
        await rm(workDir, { recursive: true, force: true });
    });

    it('finds indexed notebook sources and respects source filters', () => {
        upsertNotebookSourceIndex(workDir, {
            notebook: 'search-nb',
            entryId: 'notebooks/search-nb/react-guide.md',
            title: 'React Guide',
            source: null,
            summary: null,
            tagsJson: null,
            content: 'TypeScript interfaces keep React components typed and maintainable.',
        });
        upsertNotebookSourceIndex(workDir, {
            notebook: 'search-nb',
            entryId: 'notebooks/search-nb/vue-guide.md',
            title: 'Vue Guide',
            source: null,
            summary: null,
            tagsJson: null,
            content: 'Vue templates emphasize declarative rendering.',
        });

        const hits = searchKnowledge({
            workDir,
            query: 'TypeScript',
            kinds: ['notebook_source'],
            notebook: 'search-nb',
            sourceIds: ['react-guide'],
        });

        expect(hits).toHaveLength(1);
        expect(hits[0].sourceId).toBe('react-guide');
        expect(hits[0].text).toContain('TypeScript');
    });

    it('falls back to LIKE search for CJK queries', () => {
        upsertNotebookNoteIndex(workDir, {
            notebook: 'prefs-nb',
            noteId: 'note-1',
            title: '阅读偏好',
            content: '深色主题适合夜间阅读。',
            createdAt: 1,
            updatedAt: 1,
        });

        const hits = searchKnowledge({
            workDir,
            query: '深色主题',
            kinds: ['notebook_note'],
            notebook: 'prefs-nb',
        });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('阅读偏好');
        expect(hits[0].text).toContain('深色主题');
    });

    it('matches non-contiguous CJK phrase queries via token-aware LIKE fallback', () => {
        upsertNotebookNoteIndex(workDir, {
            notebook: 'prefs-nb',
            noteId: 'note-2',
            title: '夜间模式建议',
            content: '深色主题适合夜间阅读，也适合长时间浏览。',
            createdAt: 1,
            updatedAt: 1,
        });

        const hits = searchKnowledge({
            workDir,
            query: '夜间主题',
            kinds: ['notebook_note'],
            notebook: 'prefs-nb',
        });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('夜间模式建议');
        expect(hits[0].text).toContain('夜间阅读');
    });
});