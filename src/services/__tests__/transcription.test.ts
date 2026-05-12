import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing transcription
vi.mock('../../config.js', () => ({
    getOpenAIApiKey: vi.fn(),
    getGeminiApiKey: vi.fn(),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
    log: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { transcribeAudio, MAX_AUDIO_BYTES } from '../transcription.js';
import { getOpenAIApiKey, getGeminiApiKey } from '../../config.js';

const mockGetOpenAIApiKey = vi.mocked(getOpenAIApiKey);
const mockGetGeminiApiKey = vi.mocked(getGeminiApiKey);

const FAKE_AUDIO = Buffer.from('RIFF fake audio data');

// Helper: build a mock OpenAI Whisper response
function mockOpenAISuccess(text: string) {
    return new Response(text, { status: 200 });
}

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
        mockGetOpenAIApiKey.mockResolvedValue(null as unknown as string);
        mockGetGeminiApiKey.mockResolvedValue(null as unknown as string);

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' }),
        ).rejects.toThrow(/No transcription provider/i);
    });

    it('calls OpenAI Whisper when OpenAI key is configured', async () => {
        mockGetOpenAIApiKey.mockResolvedValue('sk-test');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOpenAISuccess('Hello world'));

        const result = await transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' });

        expect(result).toBe('Hello world');
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
        expect(url).toContain('openai.com/v1/audio/transcriptions');
    });

    it('falls back to Gemini when only Gemini key is configured', async () => {
        mockGetOpenAIApiKey.mockResolvedValue(null as unknown as string);
        mockGetGeminiApiKey.mockResolvedValue('AIzaSy-test');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockGeminiSuccess('Bonjour'));

        const result = await transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' });

        expect(result).toBe('Bonjour');
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
        expect(url).toContain('generativelanguage.googleapis.com');
    });

    it('prefers OpenAI over Gemini when both keys are configured', async () => {
        mockGetOpenAIApiKey.mockResolvedValue('sk-openai');
        mockGetGeminiApiKey.mockResolvedValue('AIza-gemini');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOpenAISuccess('OpenAI result'));

        const result = await transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/mp4' });

        expect(result).toBe('OpenAI result');
        // Only one fetch call (OpenAI) — Gemini must not be called
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
        expect(url).toContain('openai.com');
    });

    it('throws on OpenAI API error response', async () => {
        mockGetOpenAIApiKey.mockResolvedValue('sk-bad');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response('invalid_api_key', { status: 401 }),
        );

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm' }),
        ).rejects.toThrow(/OpenAI transcription failed \(401\)/);
    });

    it('throws on Gemini API error response', async () => {
        mockGetOpenAIApiKey.mockResolvedValue(null as unknown as string);
        mockGetGeminiApiKey.mockResolvedValue('AIza-bad');
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response('quota exceeded', { status: 429 }),
        );

        await expect(
            transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/ogg' }),
        ).rejects.toThrow(/Gemini transcription failed \(429\)/);
    });

    it('throws when Gemini returns empty transcription text', async () => {
        mockGetOpenAIApiKey.mockResolvedValue(null as unknown as string);
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

    it('passes language hint to OpenAI when provided', async () => {
        mockGetOpenAIApiKey.mockResolvedValue('sk-test');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockOpenAISuccess('你好'));

        await transcribeAudio({ buffer: FAKE_AUDIO, mimeType: 'audio/webm', language: 'zh' });

        // The FormData body passed to fetch should contain the language field
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
        const formData = options.body as FormData;
        expect(formData.get('language')).toBe('zh');
    });

    it('MAX_AUDIO_BYTES equals 25 MB', () => {
        expect(MAX_AUDIO_BYTES).toBe(25 * 1024 * 1024);
    });
});
