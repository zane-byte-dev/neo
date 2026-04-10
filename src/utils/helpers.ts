/**
 * helpers.ts — Shared lightweight utilities (vault path, one-shot Gemini call).
 */
import { resolve } from 'path';
import { WORK_DIR, GEMINI_API_KEY, GEMINI_MODEL_ENV, GEMINI_BASE_URL } from '../config.js';

/** Resolve the vault / workspace root from WORK_DIR env. */
export function getVaultRoot(): string {
    return WORK_DIR ? resolve(WORK_DIR) : process.cwd();
}

/** Return the resolved WORK_DIR path, or undefined if not configured. */
export function getConfiguredWorkDir(): string | undefined {
    return WORK_DIR ? resolve(WORK_DIR) : undefined;
}

/** Lightweight one-shot Gemini call (no tool use, no history). */
export async function callGemini(
    prompt: string,
    opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string | null> {
    const apiKey = GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const model = GEMINI_MODEL_ENV ?? 'gemini-2.0-flash';
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: opts.temperature ?? 0.5,
                maxOutputTokens: opts.maxOutputTokens ?? 1024,
            },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[Cron/Gemini] API error ${res.status}: ${errText}`);
        return null;
    }

    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (
        (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null
    );
}
