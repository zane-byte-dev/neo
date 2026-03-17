/**
 * _helpers.ts — Shared utilities for cron jobs.
 */
import { resolve } from 'path';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Resolve the vault / workspace root from WORK_DIR env. */
export function getVaultRoot(): string {
    const raw = process.env.WORK_DIR || '';
    return raw ? resolve(raw) : process.cwd();
}

/** Lightweight one-shot Gemini call (no tool use, no history). */
export async function callGemini(
    prompt: string,
    opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    const data = (await res.json()) as any;
    return (
        (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null
    );
}
