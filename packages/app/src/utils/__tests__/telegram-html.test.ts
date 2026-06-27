import { describe, it, expect } from 'vitest';
import { escapeHtml, markdownToTelegramHtml, splitTelegramText } from '../telegram-html.js';

describe('escapeHtml', () => {
    it('escapes &, <, and >', () => {
        expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    });

    it('leaves normal text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

describe('markdownToTelegramHtml', () => {
    it('converts fenced code block to <pre>', () => {
        const md = '```\nconst x = 1;\n```';
        expect(markdownToTelegramHtml(md)).toBe('<pre>const x = 1;</pre>');
    });

    it('converts fenced code block with language to <pre><code class="...">', () => {
        const md = '```js\nconst x = 1;\n```';
        expect(markdownToTelegramHtml(md)).toContain('<pre><code class="language-js">');
        expect(markdownToTelegramHtml(md)).toContain('const x = 1;');
    });

    it('converts **bold** to <b>', () => {
        const result = markdownToTelegramHtml('**hello**');
        expect(result).toBe('<b>hello</b>');
    });

    it('converts *italic* to <i>', () => {
        const result = markdownToTelegramHtml('*hello*');
        expect(result).toBe('<i>hello</i>');
    });

    it('converts ~~strikethrough~~ to <s>', () => {
        const result = markdownToTelegramHtml('~~deleted~~');
        expect(result).toBe('<s>deleted</s>');
    });

    it('converts [text](url) to <a href>', () => {
        const result = markdownToTelegramHtml('[click](https://example.com)');
        expect(result).toBe('<a href="https://example.com">click</a>');
    });

    it('converts > blockquote to <blockquote>', () => {
        const result = markdownToTelegramHtml('> quoted text');
        expect(result).toContain('<blockquote>');
        expect(result).toContain('quoted text');
        expect(result).toContain('</blockquote>');
    });

    it('converts # heading to <b>', () => {
        const result = markdownToTelegramHtml('# Title');
        expect(result).toBe('<b>Title</b>');
    });

    it('converts ## h2 heading to <b>', () => {
        const result = markdownToTelegramHtml('## Subtitle');
        expect(result).toBe('<b>Subtitle</b>');
    });

    it('converts `inline code` to <code>', () => {
        const result = markdownToTelegramHtml('use `npm install`');
        expect(result).toContain('<code>npm install</code>');
    });
});

describe('splitTelegramText', () => {
    it('returns single element for short text', () => {
        const result = splitTelegramText('Hello, world!');
        expect(result).toEqual(['Hello, world!']);
    });

    it('splits text longer than 3800 chars', () => {
        const text = 'a'.repeat(8000);
        const parts = splitTelegramText(text);
        expect(parts.length).toBeGreaterThan(1);
        // All parts should be ≤ 3800
        for (const part of parts) {
            expect(part.length).toBeLessThanOrEqual(3800);
        }
        // Concatenated parts should produce original text
        expect(parts.join('')).toBe(text);
    });

    it('returns "(empty response)" for empty text', () => {
        expect(splitTelegramText('')).toEqual(['(empty response)']);
        expect(splitTelegramText('   ')).toEqual(['(empty response)']);
    });

    it('prefers splitting at newline boundaries', () => {
        // Build text with newlines every 100 chars, totaling > 5000
        const line = 'x'.repeat(99) + '\n';
        const text = line.repeat(50); // 5000 chars
        const parts = splitTelegramText(text);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts[0].length).toBeLessThanOrEqual(3800);
        // The split should happen at a newline boundary, not mid-line.
        // lastIndexOf('\n', 3800) finds newline at 3799, so slice(0,3799) = 3799 chars.
        // That's 38 full lines (3800 chars) minus the trailing newline.
        expect(parts[0].length).toBe(3799);
    });
});
