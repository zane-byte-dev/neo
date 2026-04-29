import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

// Mock document-parser — parseDocument for text files
vi.mock('../../services/document-parser.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/document-parser.js')>();
    return {
        ...actual,
        parseDocument: vi.fn().mockImplementation(async (buffer: Buffer, filename: string, mimeType: string) => {
            const ext = filename.split('.').pop()?.toLowerCase() ?? '';
            if (ext === 'txt' || ext === 'md' || mimeType.startsWith('text/')) {
                return { text: buffer.toString('utf8'), filename, mimeType };
            }
            return null;
        }),
    };
});

import { uploadRoute } from '../upload.js';

const cookie = signedCookie('testuser');

function buildApp() {
    const { app, router, mount } = createTestApp();
    uploadRoute(router);
    mount();
    return app;
}

describe('POST /api/upload', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('uploads a text file and extracts text', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/upload')
            .set('Cookie', cookie)
            .attach('file', Buffer.from('Hello, world!'), { filename: 'readme.txt', contentType: 'text/plain' });
        expect(res.status).toBe(200);
        expect(res.body.files).toBeDefined();
        expect(res.body.files[0].type).toBe('document');
        expect(res.body.files[0].text).toBe('Hello, world!');
    });

    it('uploads an image and returns base64 data URL', async () => {
        const app = buildApp();
        // Minimal 1x1 PNG
        const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRElEQkSuQmCC', 'base64');
        const res = await request(app.callback())
            .post('/api/upload')
            .set('Cookie', cookie)
            .attach('file', pngBuf, { filename: 'test.png', contentType: 'image/png' });
        expect(res.status).toBe(200);
        expect(res.body.files[0].type).toBe('image');
        expect(res.body.files[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('returns 400 for unsupported file type only', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/upload')
            .set('Cookie', cookie)
            .attach('file', Buffer.from([0x00, 0x01]), { filename: 'data.bin', contentType: 'application/octet-stream' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('No supported files');
    });
});
