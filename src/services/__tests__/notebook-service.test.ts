import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
    nbCreate,
    nbGet,
    nbList,
    nbListNotebooks,
    nbUpdate,
    nbDelete,
    nbSearch,
    nbGetByTitle,
    nbImportSource,
    nbGetSourceEntry,
    nbGetSourceGuide,
    nbSaveSourceGuide,
    nbListSourcesWithGuides,
    nbGetConfig,
    nbSetConfig,
    nbSaveNote,
    nbListNotes,
    nbDeleteNote,
    nbConvertNoteToSource,
    nbSaveArtifact,
    nbGetArtifact,
    nbListArtifacts,
    nbDeleteArtifact,
    nbAppendChatMessage,
    nbReadChatHistory,
    nbForkChatHistory,
    nbClearChatHistory,
} from '../notebook-service.js';

let workDir: string;

beforeEach(async () => {
    workDir = join(tmpdir(), `neo-test-nb-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe('nbCreate', () => {
    it('creates a notebook entry and writes the file', () => {
        const entry = nbCreate(workDir, 'tech', {
            title: 'Test Article',
            content: 'Hello world',
            date: '2024-01-15',
        });

        expect(entry.notebook).toBe('tech');
        expect(entry.title).toBe('Test Article');
        expect(entry.content).toBe('Hello world');
        expect(entry.id).toContain('notebooks/tech/');
        expect(entry.filename).toContain('Test_Article');
        expect(entry.date).toBe('2024-01-15');
    });

    it('filters special characters from filename', () => {
        const entry = nbCreate(workDir, 'test', {
            title: 'Hello <World> "Quotes"',
            content: 'body',
        });
        expect(entry.filename).not.toMatch(/[<>"]/);
    });

    it('writes tags into frontmatter', () => {
        const entry = nbCreate(workDir, 'test', {
            title: 'Tagged Article',
            tags: JSON.stringify(['tag1', 'tag2']),
            content: 'body',
        });
        expect(entry.tags).toBe(JSON.stringify(['tag1', 'tag2']));
    });
});

describe('nbGet', () => {
    it('retrieves a created notebook entry with content', () => {
        const created = nbCreate(workDir, 'tech', {
            title: 'Read Me',
            content: 'Some content here',
        });

        const retrieved = nbGet(workDir, created.id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.title).toBe('Read Me');
        expect(retrieved!.content).toBe('Some content here');
    });

    it('returns undefined for non-existent entry', () => {
        expect(nbGet(workDir, 'notebooks/none/nope.md')).toBeUndefined();
    });

    it('blocks path traversal (returns undefined)', () => {
        expect(nbGet(workDir, '../../../etc/passwd')).toBeUndefined();
    });
});

describe('nbUpdate', () => {
    it('updates title and content', () => {
        const created = nbCreate(workDir, 'test', {
            title: 'Original',
            content: 'Original body',
        });

        const updated = nbUpdate(workDir, created.id, {
            title: 'Updated Title',
            content: 'Updated body',
        });

        expect(updated).toBeDefined();
        expect(updated!.title).toBe('Updated Title');
        expect(updated!.content).toBe('Updated body');
    });

    it('partially updates only specified fields', () => {
        const created = nbCreate(workDir, 'test', {
            title: 'Keep Title',
            content: 'Keep body',
            summary: 'Original summary',
        });

        const updated = nbUpdate(workDir, created.id, { summary: 'New summary' });
        expect(updated).toBeDefined();
        expect(updated!.title).toBe('Keep Title');
        expect(updated!.summary).toBe('New summary');
    });

    it('returns undefined for non-existent entry', () => {
        expect(nbUpdate(workDir, 'notebooks/nope/nope.md', { title: 'x' })).toBeUndefined();
    });
});

describe('nbDelete', () => {
    it('deletes an existing entry and returns true', () => {
        const created = nbCreate(workDir, 'test', {
            title: 'To Delete',
            content: 'bye',
        });

        expect(nbDelete(workDir, created.id)).toBe(true);
        expect(nbGet(workDir, created.id)).toBeUndefined();
    });

    it('returns false for non-existent entry', () => {
        expect(nbDelete(workDir, 'notebooks/nope/nope.md')).toBe(false);
    });

    it('blocks path traversal and returns false', () => {
        expect(nbDelete(workDir, '../../../etc/passwd')).toBe(false);
    });
});

describe('nbList', () => {
    it('lists all notebook entries without content', () => {
        nbCreate(workDir, 'notes', { title: 'A', content: 'body a' });
        nbCreate(workDir, 'notes', { title: 'B', content: 'body b' });

        // nbList now auto-scans workDir/notebooks/ with the notebook name
        const list = nbList(workDir, { notebook: 'notes' });
        expect(list.length).toBe(2);
        // content should NOT be included
        for (const entry of list) {
            expect(entry).not.toHaveProperty('content');
        }
    });

    it('respects limit parameter', () => {
        for (let i = 0; i < 5; i++) {
            nbCreate(workDir, 'many', { title: `Item ${i}`, content: `body ${i}` });
        }
        const list = nbList(workDir, { notebook: 'many', limit: 3 });
        expect(list.length).toBe(3);
    });
});

describe('nbListNotebooks', () => {
    it('returns subdirectory names', () => {
        nbCreate(workDir, 'alpha', { title: 'A', content: 'a' });
        nbCreate(workDir, 'beta', { title: 'B', content: 'b' });

        const names = nbListNotebooks(workDir);
        expect(names).toContain('alpha');
        expect(names).toContain('beta');
    });

    it('excludes .tmp and hidden directories', async () => {
        const nbDir = join(workDir, 'notebooks');
        await fs.mkdir(join(nbDir, '.tmp'), { recursive: true });
        await fs.mkdir(join(nbDir, '.hidden'), { recursive: true });
        await fs.mkdir(join(nbDir, 'visible'), { recursive: true });

        const names = nbListNotebooks(workDir);
        expect(names).toContain('visible');
        expect(names).not.toContain('.tmp');
        expect(names).not.toContain('.hidden');
    });

    it('returns empty array for non-existent directory', () => {
        expect(nbListNotebooks('/nonexistent/path')).toEqual([]);
    });
});

describe('nbSearch', () => {
    it('finds entries by title match', () => {
        nbCreate(workDir, 'search', { title: 'TypeScript Tutorial', content: 'Learn TS' });
        nbCreate(workDir, 'search', { title: 'Python Guide', content: 'Learn Python' });

        const results = nbSearch(workDir, 'typescript', { notebook: 'search' });
        expect(results.length).toBe(1);
        expect(results[0].title).toBe('TypeScript Tutorial');
    });

    it('finds entries by body content match with snippet', () => {
        nbCreate(workDir, 'search', { title: 'Boring Title', content: 'The unique keyword zebra is here' });

        const results = nbSearch(workDir, 'zebra', { notebook: 'search' });
        expect(results.length).toBe(1);
        expect(results[0].snippet).toBeDefined();
        expect(results[0].snippet).toContain('zebra');
    });

    it('returns empty array when no match', () => {
        nbCreate(workDir, 'search', { title: 'No Match', content: 'Nothing' });
        const results = nbSearch(workDir, 'xyznonexistent', { notebook: 'search' });
        expect(results).toEqual([]);
    });
});

describe('nbGetByTitle', () => {
    it('finds entry by fuzzy title match', () => {
        nbCreate(workDir, 'find', { title: 'Machine Learning Basics', content: 'ML content' });

        const result = nbGetByTitle(workDir, 'machine learning', 'find');
        expect(result).toBeDefined();
        expect(result!.title).toBe('Machine Learning Basics');
        expect(result!.content).toBeDefined();
    });

    it('returns undefined when no match', () => {
        expect(nbGetByTitle(workDir, 'nonexistent query')).toBeUndefined();
    });
});

describe('source guide primitives', () => {
    it('saves, reads, and merges guides into source listings', () => {
        const video = nbImportSource(workDir, 'study', {
            title: 'Video Source',
            content: 'Video transcript',
            source: 'https://youtube.com/watch?v=abc123',
        });
        const article = nbImportSource(workDir, 'study', {
            title: 'Article Source',
            content: 'Article body',
            source: 'https://example.com/post',
        });

        const guide = {
            sourceId: video.id,
            summary: '视频摘要',
            keyTopics: ['主题'],
            suggestedQuestions: ['问题'],
            generatedAt: 123,
        };

        nbSaveSourceGuide(workDir, 'study', guide);

        expect(nbGetSourceGuide(workDir, 'study', video.id)).toEqual(guide);

        const listed = nbListSourcesWithGuides(workDir, 'study');
        const listedVideo = listed.find((item) => item.id === video.id);
        const listedArticle = listed.find((item) => item.id === article.id);

        expect(listedVideo?.type).toBe('youtube');
        expect(listedVideo?.guide).toEqual(guide);
        expect(listedArticle?.type).toBe('url');
        expect(listedArticle?.guide).toBeNull();
    });
});

describe('notebook config primitives', () => {
    it('returns defaults for missing config and round-trips saved config', () => {
        expect(nbGetConfig(workDir, 'cfg')).toEqual({});

        nbSetConfig(workDir, 'cfg', {
            emoji: '📘',
            description: 'Study notes',
            chatStyle: 'study-guide',
            answerLength: 'long',
            citationMode: 'mixed',
        });

        expect(nbGetConfig(workDir, 'cfg')).toEqual({
            emoji: '📘',
            description: 'Study notes',
            chatStyle: 'study-guide',
            answerLength: 'long',
            citationMode: 'mixed',
        });
    });
});

describe('note primitives', () => {
    it('saves, lists, and deletes notes', () => {
        const note = nbSaveNote(workDir, 'notes-nb', {
            title: 'Key Points',
            content: 'A\nB',
            source: 'ai-chat',
        });

        const notes = nbListNotes(workDir, 'notes-nb');
        expect(notes).toHaveLength(1);
        expect(notes[0].id).toBe(note.id);
        expect(notes[0].title).toBe('Key Points');
        expect(notes[0].source).toBe('ai-chat');

        expect(nbDeleteNote(workDir, 'notes-nb', note.id)).toBe(true);
        expect(nbListNotes(workDir, 'notes-nb')).toEqual([]);
    });

    it('converts a note into a source and removes the original note', () => {
        const note = nbSaveNote(workDir, 'notes-nb', {
            title: 'Draft Summary',
            content: 'Draft body content',
        });

        const converted = nbConvertNoteToSource(workDir, 'notes-nb', note.id);
        expect(converted).toBeDefined();
        expect(converted?.title).toBe('Draft Summary');

        expect(nbListNotes(workDir, 'notes-nb')).toEqual([]);

        const entry = nbGetSourceEntry(workDir, 'notes-nb', converted!.id);
        expect(entry).toBeDefined();
        expect(entry?.content).toBe('Draft body content');
    });
});

describe('artifact primitives', () => {
    it('saves, reads, filters, and deletes artifacts', () => {
        nbSaveArtifact(workDir, 'artifacts-nb', {
            id: 'report1',
            type: 'report',
            title: 'Weekly Report',
            data: { markdown: '# Weekly Report' },
        });
        nbSaveArtifact(workDir, 'artifacts-nb', {
            id: 'mindmap1',
            type: 'mindmap',
            title: 'Mind Map',
            data: { markdown: '# Mind Map' },
        });

        expect(nbGetArtifact(workDir, 'artifacts-nb', 'report1')?.title).toBe('Weekly Report');
        expect(nbListArtifacts(workDir, 'artifacts-nb')).toHaveLength(2);
        expect(nbListArtifacts(workDir, 'artifacts-nb', 'report').map((artifact) => artifact.id)).toEqual(['report1']);

        expect(nbDeleteArtifact(workDir, 'artifacts-nb', 'report1')).toBe(true);
        expect(nbGetArtifact(workDir, 'artifacts-nb', 'report1')).toBeUndefined();
    });
});

describe('notebook chat primitives', () => {
    it('appends, reads, forks, and clears notebook chat history', () => {
        nbAppendChatMessage(workDir, 'chat-nb', {
            id: 'm1',
            role: 'user',
            content: 'hello',
            timestamp: 1,
        });
        nbAppendChatMessage(workDir, 'chat-nb', {
            id: 'm2',
            role: 'assistant',
            content: 'hi',
            timestamp: 2,
        });
        nbAppendChatMessage(workDir, 'chat-nb', {
            id: 'm3',
            role: 'user',
            content: 'follow up',
            timestamp: 3,
        });

        expect(nbReadChatHistory(workDir, 'chat-nb').map((msg) => msg.id)).toEqual(['m1', 'm2', 'm3']);

        const kept = nbForkChatHistory(workDir, 'chat-nb', 'm2');
        expect(kept.map((msg) => msg.id)).toEqual(['m1', 'm2']);
        expect(nbReadChatHistory(workDir, 'chat-nb').map((msg) => msg.id)).toEqual(['m1', 'm2']);

        nbClearChatHistory(workDir, 'chat-nb');
        expect(nbReadChatHistory(workDir, 'chat-nb')).toEqual([]);
    });
});
