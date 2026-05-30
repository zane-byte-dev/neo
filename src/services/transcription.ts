/**
 * transcription.ts — Audio transcription service.
 *
 * Converts audio blobs to text using configured LLM providers.
 * Priority order: Gemini (gemini-1.5-flash via inline audio) as primary.
 *
 * Returns the transcribed text, or throws if no provider is configured or
 * transcription fails.
 */

import { getGeminiApiKey } from '../config.js';
import { log } from '../utils/logger.js';

export interface TranscribeOptions {
    /** Audio buffer (e.g. webm, mp4, ogg, wav — provider-dependent). */
    buffer: Buffer;
    /** MIME type of the audio, e.g. 'audio/webm', 'audio/mp4', 'audio/ogg'. */
    mimeType: string;
    /** Optional filename hint. */
    filename?: string;
    /** BCP-47 language hint, e.g. 'zh', 'en'. If omitted, auto-detect. */
    language?: string;
}

/** Max audio size accepted (25 MB). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe audio to text using Gemini.
 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
    const geminiKey = await getGeminiApiKey();
    if (geminiKey) {
        return transcribeWithGemini(opts, geminiKey);
    }

    throw new Error('No transcription provider configured. Please add a Gemini API key.');
}

// ── Gemini multimodal transcription ────────────────────────────────────────────

async function transcribeWithGemini(opts: TranscribeOptions, apiKey: string): Promise<string> {
    const { buffer, mimeType } = opts;

    // Gemini Flash: send audio inline and ask for a transcription.
    const b64 = buffer.toString('base64');

    const body = {
        contents: [{
            parts: [
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: b64,
                    },
                },
                {
                    text: 'Please transcribe the audio exactly as spoken. Return only the transcribed text, with no extra commentary or formatting.',
                },
            ],
        }],
        generation_config: {
            temperature: 0,
            max_output_tokens: 2048,
        },
    };

    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Gemini transcription failed (${res.status}): ${msg}`);
    }

    const json = await res.json() as {
        candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> }
        }>
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Gemini returned empty transcription.');
    log.debug('Transcription', `Gemini transcribed ${buffer.byteLength} bytes`);
    return text.trim();
}
