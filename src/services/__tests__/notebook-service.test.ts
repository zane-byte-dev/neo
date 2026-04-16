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

        // nbList scans from workDir root — entries are under notebooks/
        const list = nbList(workDir, { notebook: 'notebooks/notes' });
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
        const list = nbList(workDir, { notebook: 'notebooks/many', limit: 3 });
        expect(list.length).toBe(3);
    });
});

describe('nbListNotebooks', () => {
    it('returns subdirectory names', () => {
        nbCreate(workDir, 'alpha', { title: 'A', content: 'a' });
        nbCreate(workDir, 'beta', { title: 'B', content: 'b' });

        const nbDir = join(workDir, 'notebooks');
        const names = nbListNotebooks(nbDir);
        expect(names).toContain('alpha');
        expect(names).toContain('beta');
    });

    it('excludes .tmp and hidden directories', async () => {
        await fs.mkdir(join(workDir, '.tmp'), { recursive: true });
        await fs.mkdir(join(workDir, '.hidden'), { recursive: true });
        await fs.mkdir(join(workDir, 'visible'), { recursive: true });

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

        const results = nbSearch(workDir, 'typescript', { notebook: 'notebooks/search' });
        expect(results.length).toBe(1);
        expect(results[0].title).toBe('TypeScript Tutorial');
    });

    it('finds entries by body content match with snippet', () => {
        nbCreate(workDir, 'search', { title: 'Boring Title', content: 'The unique keyword zebra is here' });

        const results = nbSearch(workDir, 'zebra', { notebook: 'notebooks/search' });
        expect(results.length).toBe(1);
        expect(results[0].snippet).toBeDefined();
        expect(results[0].snippet).toContain('zebra');
    });

    it('returns empty array when no match', () => {
        nbCreate(workDir, 'search', { title: 'No Match', content: 'Nothing' });
        const results = nbSearch(workDir, 'xyznonexistent', { notebook: 'notebooks/search' });
        expect(results).toEqual([]);
    });
});

describe('nbGetByTitle', () => {
    it('finds entry by fuzzy title match', () => {
        nbCreate(workDir, 'find', { title: 'Machine Learning Basics', content: 'ML content' });

        const result = nbGetByTitle(workDir, 'machine learning', 'notebooks/find');
        expect(result).toBeDefined();
        expect(result!.title).toBe('Machine Learning Basics');
        expect(result!.content).toBeDefined();
    });

    it('returns undefined when no match', () => {
        expect(nbGetByTitle(workDir, 'nonexistent query')).toBeUndefined();
    });
});
