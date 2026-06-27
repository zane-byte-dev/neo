/**
 * src/routes/generate.ts — Text generation for the Novel editor AI.
 *
 * POST /api/generate
 *   Body: { prompt: string, command?: string, instruction?: string, model?: string }
 *
 * Uses LLMClient (with full fallback chain / model routing) and streams the
 * result as plain text so the front-end ReadableStream consumer works as-is.
 *
 * Supported commands:
 *   continue   — continue writing from the given text
 *   improve    — improve/rewrite the given text
 *   shorter    — make the text shorter
 *   longer     — make the text longer
 *   fix        — fix grammar and spelling
 *   zap        — generate content from a free-form instruction
 */
import type Router from '@koa/router';
import { LLMClient } from '@neo/agent/llm/client.js';
import { log } from '@neo/agent/utils/logger.js';

const MODULE = 'GenerateRoute';

let _client: LLMClient | null = null;
function getClient(): LLMClient {
    if (!_client) _client = new LLMClient();
    return _client;
}

const SYSTEM_PROMPT = `You are an AI writing assistant. When given a writing task, respond with only the requested text — no preamble, no explanation, no markdown fences unless the user's content is already in markdown. Match the style and language of the provided content.`;

type EditorCommand = 'continue' | 'improve' | 'shorter' | 'longer' | 'fix' | 'zap';

function buildPrompt(command: EditorCommand | string, text: string, instruction?: string): string {
    switch (command) {
        case 'continue':
            return `Continue the following text naturally, preserving its tone and style. Output only the continuation, not the original:\n\n${text}`;
        case 'improve':
            return `Improve the following text to make it clearer, more engaging, and better written. Output only the improved version:\n\n${text}`;
        case 'shorter':
            return `Make the following text shorter and more concise while preserving all key information. Output only the shortened version:\n\n${text}`;
        case 'longer':
            return `Expand the following text with more detail and depth while keeping the same style. Output only the expanded version:\n\n${text}`;
        case 'fix':
            return `Fix the grammar, spelling, and punctuation in the following text. Output only the corrected version:\n\n${text}`;
        case 'zap':
            return instruction
                ? `${instruction}\n\nBase your response on the following context:\n\n${text}`
                : `Generate content related to:\n\n${text}`;
        default:
            return `${command}\n\nContext:\n\n${text}`;
    }
}

export function generateRoute(router: Router): void {
    router.post('/api/generate', async (ctx) => {
        const body = ctx.request.body as Record<string, unknown>;

        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const command = typeof body.command === 'string' ? body.command.trim() : 'continue';
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : undefined;
        const modelAlias = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

        if (!prompt) {
            ctx.status = 400;
            ctx.body = { error: 'prompt is required' };
            return;
        }

        const userPrompt = buildPrompt(command as EditorCommand, prompt, instruction);
        log.info(MODULE, `generate command=${command} model=${modelAlias ?? 'default'} promptLen=${prompt.length}`);

        try {
            const text = await getClient().generate(userPrompt, {
                model: modelAlias,
                system: SYSTEM_PROMPT,
            });

            if (!text) {
                ctx.status = 503;
                ctx.body = { error: 'No model available' };
                return;
            }

            // Stream the result as plain text (front-end uses ReadableStream)
            ctx.status = 200;
            ctx.set({
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            ctx.body = text;
        } catch (err) {
            log.error(MODULE, 'generate failed', { error: err instanceof Error ? err.message : String(err) });
            ctx.status = 500;
            ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
    });
}
