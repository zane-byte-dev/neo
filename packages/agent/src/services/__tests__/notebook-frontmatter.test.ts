import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, titleFromFilename } from '../notebook-service.js';

describe('parseFrontmatter', () => {
    it('parses standard YAML frontmatter with all fields', () => {
        const text = `---
title: My Article
date: 2026-01-15
author: Alice
source: https://example.com
summary: A short summary
tags: [coding, ai]
---
Body content here.`;

        const { meta, body } = parseFrontmatter(text);
        expect(meta.title).toBe('My Article');
        expect(meta.date).toBe('2026-01-15');
        expect(meta.author).toBe('Alice');
        expect(meta.source).toBe('https://example.com');
        expect(meta.summary).toBe('A short summary');
        expect(meta.tags).toEqual(['coding', 'ai']);
        expect(body).toBe('Body content here.');
    });

    it('returns empty meta and full body when no frontmatter', () => {
        const text = 'Just plain text content.';
        const { meta, body } = parseFrontmatter(text);
        expect(meta).toEqual({});
        expect(body).toBe('Just plain text content.');
    });

    it('returns undefined for missing fields', () => {
        const text = `---
title: Partial
---
Some body.`;

        const { meta, body } = parseFrontmatter(text);
        expect(meta.title).toBe('Partial');
        expect(meta.date).toBeUndefined();
        expect(meta.author).toBeUndefined();
        expect(meta.source).toBeUndefined();
        expect(meta.summary).toBeUndefined();
        expect(meta.tags).toBeUndefined();
        expect(body).toBe('Some body.');
    });

    it('parses tags array with quoted values', () => {
        const text = `---
title: Tags Test
tags: ["tag one", 'tag two', tag-three]
---
Content.`;

        const { meta } = parseFrontmatter(text);
        expect(meta.tags).toEqual(['tag one', 'tag two', 'tag-three']);
    });
});

describe('serializeFrontmatter', () => {
    it('serializes meta + body to standard format', () => {
        const meta = {
            title: 'Test Title',
            date: '2026-03-01',
            author: 'Bob',
            tags: ['a', 'b'],
        };
        const result = serializeFrontmatter(meta, 'Hello world.');

        expect(result).toContain('---');
        expect(result).toContain('title: Test Title');
        expect(result).toContain('date: 2026-03-01');
        expect(result).toContain('author: Bob');
        expect(result).toContain('tags: [a, b]');
        expect(result).toContain('Hello world.');
    });

    it('round-trip: serialize then parse preserves data', () => {
        const meta = {
            title: 'Round Trip',
            date: '2026-04-01',
            author: 'Charlie',
            summary: 'A summary',
            tags: ['x', 'y'],
        };
        const body = 'Some content\nwith multiple lines.';

        const serialized = serializeFrontmatter(meta, body);
        const { meta: parsed, body: parsedBody } = parseFrontmatter(serialized);

        expect(parsed.title).toBe(meta.title);
        expect(parsed.date).toBe(meta.date);
        expect(parsed.author).toBe(meta.author);
        expect(parsed.summary).toBe(meta.summary);
        expect(parsed.tags).toEqual(meta.tags);
        expect(parsedBody).toBe(body);
    });
});

describe('titleFromFilename', () => {
    it('removes .md suffix', () => {
        expect(titleFromFilename('hello.md')).toBe('hello');
    });

    it('removes date prefix and converts underscores to spaces', () => {
        expect(titleFromFilename('20260101_my_article.md')).toBe('my article');
    });

    it('handles filename with no prefix or suffix transformations', () => {
        expect(titleFromFilename('simple')).toBe('simple');
    });
});
