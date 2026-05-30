import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing transcription
vi.mock('../../config.js', () => ({
    getGeminiApiKey: vi.fn(),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { transcribeAudio, MAX_AUDIO_BYTES } from '../transcription.js';
import { getGeminiApiKey } from '../../config.js';

const mockGetGeminiApiKey = vi.mocked(getGeminiApiKey);

const FAKE_AUDIO = Buffer.from('RIFF fake audio data');

// Helper: build a mock Gemini generateContent response
function mockGeminiSuccess(text: string) {
    return new Response(
        JSON.stringify({
            candidates: [{ content: { parts: [{ text }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
}

describe('transcribeAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws when no provider is configured', async () => {
        mockGetGeminiApiKey.mockResolvedValue(null as unknown as string);

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' }),
        ).rejects.toThrow(/No transcription provider/i);
    });

    it('transcribes with Gemini when a Gemini key is configured', async () => {
        mockGetGeminiApiKey.mockResolvedValue('AIzaSy-test');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGeminiSuccess('Bonjour'));

        const result = await transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' });

        expect(result).toBe('Bonjour');
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
        expect(url).toContain('generativelanguage.googleapis.com');
    });

    it('throws on Gemini API error response', async () => {
        mockGetGeminiApiKey.mockResolvedValue('AIza-bad');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response('quota exceeded', { status: 429 }),
        );

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/ogg' }),
        ).rejects.toThrow(/Gemini transcription failed \(429\)/);
    });

    it('throws when Gemini returns empty transcription text', async () => {
        mockGetGeminiApiKey.mockResolvedValue('AIza-test');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(
                JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' }),
        ).rejects.toThrow(/empty transcription/i);
    });

    it('MAX_AUDIO_BYTES equals 25 MB', () => {
        expect(MAX_AUDIO_BYTES).toBe(25 * 1024 * 1024);
    });
});
