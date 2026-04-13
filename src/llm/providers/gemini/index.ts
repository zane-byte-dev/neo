/**
 * src/llm/providers/gemini/index.ts — Gemini-specific utilities.
 *
 * The main LLM orchestration has moved to AI SDK (see client.ts).
 * This file retains:
 *   - Model alias resolution (resolveModel)
 *   - File upload (geminiUploadFile) — Gemini Files API specific
 *   - Single-shot generation (geminiGenerate) — lightweight, no AI SDK overhead
 */

import { GEMINI_BASE_URL, GEMINI_FILES_UPLOAD_URL, MODEL_ALIASES } from '../../../config.js';
import type { GeminiContent } from '../../types.js';

// ── Model resolver ────────────────────────────────────────────────────────────

/** Resolve internal model aliases to real Gemini API model names. */
export function resolveModel(model: string): string {
    return MODEL_ALIASES[model] ?? model;
}

// ── Single-shot generation (raw REST, for simple tasks) ───────────────────────

export async function geminiGenerate(
    apiKey: string,
    contents: GeminiContent[],
    options: { model?: string; generationConfig?: Record<string, unknown> } = {},
): Promise<string | null> {
    const model = resolveModel(options.model ?? 'flash');
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
    const body: Record<string, unknown> = { contents };
    if (options.generationConfig) body.generationConfig = options.generationConfig;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

// ── File upload ───────────────────────────────────────────────────────────────

export async function geminiUploadFile(
    apiKey: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    const res = await fetch(
        `${GEMINI_FILES_UPLOAD_URL}?uploadType=media`,
        {
            method: 'POST',
            headers: {
                'Content-Type': mimeType,
                'x-goog-api-key': apiKey,
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Header-Content-Length': String(buffer.length),
            },
            body: buffer,
        },
    );
    if (!res.ok) throw new Error(`Gemini File API upload failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { file?: { uri?: string } };
    const uri: string | undefined = data.file?.uri;
    if (!uri) throw new Error('No fileUri returned from Gemini File API');
    return uri;
}
