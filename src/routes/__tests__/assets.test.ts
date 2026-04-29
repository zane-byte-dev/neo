/**
 * Tests for /api/assets/:sessionId/:filename.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

const calcUserMock = vi.fn();
vi.mock('../../services/user-service.js', () => ({
    calcUser: calcUserMock,
}));

let workDir: string;

beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'assets-'));
    calcUserMock.mockResolvedValue({ workDir, stateDir: workDir });
    const sd = join(workDir, 'projects', 'sess1');
    await fs.mkdir(sd, { recursive: true });
    await fs.writeFile(join(sd, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(join(sd, 'note.txt'), 'hello', 'utf8');
});

afterEach(() => rmSync(workDir, { recursive: true, force: true }));

describe('GET /api/assets/:sessionId/:filename', () => {
    it('returns 401 without auth', async () => {
        const { assetsRoute } = await import('../assets.js');
        const { app, router, mount } = createTestApp();
        assetsRoute(router); mount();
        const res = await request(app.callback()).get('/api/assets/sess1/note.txt');
        expect(res.status).toBe(401);
    });

    it('streams an existing file with the correct MIME type', async () => {
        const { assetsRoute } = await import('../assets.js');
        const { app, router, mount } = createTestApp();
        assetsRoute(router); mount();
        const res = await request(app.callback())
            .get('/api/assets/sess1/note.txt')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toBe('hello');
    });

    it('serves PNG with image/png MIME', async () => {
        const { assetsRoute } = await import('../assets.js');
        const { app, router, mount } = createTestApp();
        assetsRoute(router); mount();
        const res = await request(app.callback())
            .get('/api/assets/sess1/pic.png')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('image/png');
    });

    it('returns 404 when the file does not exist', async () => {
        const { assetsRoute } = await import('../assets.js');
        const { app, router, mount } = createTestApp();
        assetsRoute(router); mount();
        const res = await request(app.callback())
            .get('/api/assets/sess1/missing.txt')
            .set('Cookie', signedCookie('u1'));
        expect(res.status).toBe(404);
    });

    it('blocks path traversal via filename', async () => {
        const { assetsRoute } = await import('../assets.js');
        const { app, router, mount } = createTestApp();
        assetsRoute(router); mount();
        // basename strips path components — request resolves to `passwd` inside session dir
        const res = await request(app.callback())
            .get('/api/assets/sess1/' + encodeURIComponent('../../../etc/passwd'))
            .set('Cookie', signedCookie('u1'));
        // 404 because /tmp/.../sess1/passwd doesn't exist (no traversal happened)
        expect(res.status).toBe(404);
    });
});
