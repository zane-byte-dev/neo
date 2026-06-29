import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, signedCookie } from '../../__tests__/test-helpers.js';

// Mock transcription service before importing the route
vi.mock('../../services/transcription.js', () => ({
    transcribeAudio: vi.fn(),
    MAX_AUDIO_BYTES: 25 * 1024 * 1024,
}));

import { register } from '../transcribe.js';
import { transcribeAudio } from '../../services/transcription.js';

const mockTranscribeAudio = vi.mocked(transcribeAudio);
const cookie = signedCookie('testuser');

// Minimal valid webm audio stub (enough bytes for the route to parse)
const STUB_AUDIO = Buffer.alloc(256, 0x1a); // 256 bytes of arbitrary data

function buildApp() {
    const { app, router, mount } = createTestApp();
    register(router);
    mount();
    return app;
}

describe('POST /api/transcribe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 without auth cookie', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .attach('audio', STUB_AUDIO, { filename: 'voice.webm', contentType: 'audio/webm' });
        expect(res.status).toBe(401);
    });

    it('returns 400 when content-type is not multipart/form-data', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .set('Content-Type', 'application/json')
            .send('{}');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/multipart/i);
    });

    it('returns 415 for unsupported audio MIME type', async () => {
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'data.bin', contentType: 'application/octet-stream' });
        expect(res.status).toBe(415);
        expect(res.body.error).toMatch(/unsupported audio type/i);
    });

    it('returns 200 with transcribed text for valid audio', async () => {
        mockTranscribeAudio.mockResolvedValueOnce('Hello from voice');
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'voice.webm', contentType: 'audio/webm' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ text: 'Hello from voice' });
    });

    it('accepts video/webm (Chrome MediaRecorder MIME)', async () => {
        mockTranscribeAudio.mockResolvedValueOnce('Chrome audio');
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'voice.webm', contentType: 'video/webm' });
        expect(res.status).toBe(200);
        expect(res.body.text).toBe('Chrome audio');
    });

    it('accepts audio/ogg (Firefox MediaRecorder MIME)', async () => {
        mockTranscribeAudio.mockResolvedValueOnce('Firefox audio');
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'voice.ogg', contentType: 'audio/ogg' });
        expect(res.status).toBe(200);
        expect(res.body.text).toBe('Firefox audio');
    });

    it('returns 503 when transcription service throws (no provider)', async () => {
        mockTranscribeAudio.mockRejectedValueOnce(
            new Error('No transcription provider configured. Please add a Gemini API key.'),
        );
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'voice.webm', contentType: 'audio/webm' });
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/No transcription provider/i);
    });

    it('returns 503 when transcription service fails generically', async () => {
        mockTranscribeAudio.mockRejectedValueOnce(new Error('network error'));
        const app = buildApp();
        const res = await request(app.callback())
            .post('/api/transcribe')
            .set('Cookie', cookie)
            .attach('audio', STUB_AUDIO, { filename: 'voice.webm', contentType: 'audio/webm' });
        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/network error/i);
    });
});
