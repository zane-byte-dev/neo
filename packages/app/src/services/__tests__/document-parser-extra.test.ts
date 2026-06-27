import { describe, it, expect } from 'vitest';
import {
    parseDocument,
    isDocumentType,
    isImageType,
    isYouTubeUrl,
} from '../document-parser.js';

describe('parseDocument (text variants)', () => {
    it('parses .txt files via UTF-8 with truncation', async () => {
        const buf = Buffer.from('hello world', 'utf8');
        const out = await parseDocument(buf, 'a.txt', 'text/plain');
        expect(out?.text).toBe('hello world');
        expect(out?.filename).toBe('a.txt');
    });

    it('parses .md files', async () => {
        const out = await parseDocument(Buffer.from('# Title'), 'README.md', 'text/markdown');
        expect(out?.text).toBe('# Title');
    });

    it('returns null for unsupported binary types', async () => {
        const out = await parseDocument(Buffer.from([0, 1, 2]), 'mystery.bin', 'application/x-binary');
        expect(out).toBeNull();
    });

    it('uses MIME type when extension is missing', async () => {
        const out = await parseDocument(Buffer.from('hi'), 'noext', 'text/plain');
        expect(out?.text).toBe('hi');
    });
});

describe('isDocumentType', () => {
    it('accepts known extensions', () => {
        expect(isDocumentType('', 'a.pdf')).toBe(true);
        expect(isDocumentType('', 'a.docx')).toBe(true);
        expect(isDocumentType('', 'b.xlsx')).toBe(true);
        expect(isDocumentType('', 'c.txt')).toBe(true);
    });
    it('accepts text/* mime types', () => {
        expect(isDocumentType('text/plain', 'noext')).toBe(true);
    });
    it('rejects unrelated types', () => {
        expect(isDocumentType('image/png', 'a.png')).toBe(false);
        expect(isDocumentType('application/zip', 'a.zip')).toBe(false);
    });
});

describe('isImageType', () => {
    it('matches image/* prefix', () => {
        expect(isImageType('image/png')).toBe(true);
        expect(isImageType('image/jpeg')).toBe(true);
        expect(isImageType('text/plain')).toBe(false);
    });
});

describe('isYouTubeUrl', () => {
    it('matches common YouTube URL formats', () => {
        expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
        expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true);
        expect(isYouTubeUrl('https://www.youtube.com/shorts/abc')).toBe(true);
        expect(isYouTubeUrl('https://example.com/video')).toBe(false);
    });
});
