import { describe, it, expect } from 'vitest';
import { isDocumentType, isImageType, parseDocument } from '../document-parser.js';

describe('isDocumentType', () => {
    it('returns true for PDF by extension', () => {
        expect(isDocumentType('application/octet-stream', 'file.pdf')).toBe(true);
    });

    it('returns true for PDF by MIME type', () => {
        expect(isDocumentType('application/pdf', 'file.bin')).toBe(true);
    });

    it('returns true for DOCX by extension', () => {
        expect(isDocumentType('application/octet-stream', 'file.docx')).toBe(true);
    });

    it('returns true for DOCX by MIME type', () => {
        expect(isDocumentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'file.bin')).toBe(true);
    });

    it('returns true for XLSX by extension', () => {
        expect(isDocumentType('application/octet-stream', 'file.xlsx')).toBe(true);
    });

    it('returns true for XLS by extension', () => {
        expect(isDocumentType('application/octet-stream', 'file.xls')).toBe(true);
    });

    it('returns true for XLSX by MIME type', () => {
        expect(isDocumentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'file.bin')).toBe(true);
    });

    it('returns true for ms-excel MIME type', () => {
        expect(isDocumentType('application/vnd.ms-excel', 'file.bin')).toBe(true);
    });

    it('returns true for .txt text file', () => {
        expect(isDocumentType('application/octet-stream', 'readme.txt')).toBe(true);
    });

    it('returns true for .md text file', () => {
        expect(isDocumentType('application/octet-stream', 'notes.md')).toBe(true);
    });

    it('returns true for .json text file', () => {
        expect(isDocumentType('application/octet-stream', 'data.json')).toBe(true);
    });

    it('returns true for .py text file', () => {
        expect(isDocumentType('application/octet-stream', 'script.py')).toBe(true);
    });

    it('returns true for .csv text file', () => {
        expect(isDocumentType('application/octet-stream', 'data.csv')).toBe(true);
    });

    it('returns true for text/ MIME type', () => {
        expect(isDocumentType('text/plain', 'unknown.xyz')).toBe(true);
    });

    it('returns true for text/html MIME type', () => {
        expect(isDocumentType('text/html', 'page.bin')).toBe(true);
    });

    it('returns false for PNG image', () => {
        expect(isDocumentType('image/png', 'photo.png')).toBe(false);
    });

    it('returns false for JPEG image', () => {
        expect(isDocumentType('image/jpeg', 'photo.jpg')).toBe(false);
    });

    it('returns false for unknown binary type', () => {
        expect(isDocumentType('application/octet-stream', 'data.bin')).toBe(false);
    });
});

describe('isImageType', () => {
    it('returns true for image/png', () => {
        expect(isImageType('image/png')).toBe(true);
    });

    it('returns true for image/jpeg', () => {
        expect(isImageType('image/jpeg')).toBe(true);
    });

    it('returns true for image/gif', () => {
        expect(isImageType('image/gif')).toBe(true);
    });

    it('returns true for image/webp', () => {
        expect(isImageType('image/webp')).toBe(true);
    });

    it('returns false for text/plain', () => {
        expect(isImageType('text/plain')).toBe(false);
    });

    it('returns false for application/pdf', () => {
        expect(isImageType('application/pdf')).toBe(false);
    });

    it('returns false for application/octet-stream', () => {
        expect(isImageType('application/octet-stream')).toBe(false);
    });
});

describe('parseDocument', () => {
    it('extracts text from a .txt buffer', async () => {
        const content = 'Hello, this is a text file.';
        const buffer = Buffer.from(content, 'utf8');
        const result = await parseDocument(buffer, 'readme.txt', 'text/plain');
        expect(result).not.toBeNull();
        expect(result!.text).toBe(content);
        expect(result!.filename).toBe('readme.txt');
        expect(result!.mimeType).toBe('text/plain');
    });

    it('truncates text longer than MAX_EXTRACT_LENGTH', async () => {
        const content = 'a'.repeat(200_000);
        const buffer = Buffer.from(content, 'utf8');
        const result = await parseDocument(buffer, 'big.txt', 'text/plain');
        expect(result).not.toBeNull();
        expect(result!.text.length).toBe(100_000);
    });

    it('returns null for unsupported binary type', async () => {
        const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const result = await parseDocument(buffer, 'image.png', 'image/png');
        expect(result).toBeNull();
    });
});
