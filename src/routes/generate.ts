/**
 * src/routes/generate.ts — Streaming text generation for the Novel editor AI.
 *
 * POST /api/generate
 *   Body: { prompt: string, command?: string, model?: string }
 *
 * Streams plain text chunks (not SSE) so the front-end `useCompletion`-style
 * fetch consumer can read them with a ReadableStream.
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
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
    getGeminiApiKey, getOpenAIApiKey, getAnthropicApiKey, getDeepseekApiKey,
    MODEL_ALIASES, GEMINI_MODEL_ENV,
} from '../config.js';
import { calcUser } from '../services/user-service.js';
import { log } from '../utils/logger.js';

const MODULE = 'GenerateRoute';

function resolveModel(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

function createModel(modelId: string) {
    if (modelId.startsWith('deepseek')) {
        return createOpenAI({ apiKey: getDeepseekApiKey(), baseURL: 'https://api.deepseek.com' }).chat(modelId);
    }
    if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-')) {
        return createOpenAI({ apiKey: getOpenAIApiKey() }).chat(modelId);
    }
    if (modelId.startsWith('claude-')) {
        return createAnthropic({ apiKey: getAnthropicApiKey() })(modelId);
    }
    return createGoogleGenerativeAI({ apiKey: getGeminiApiKey() })(modelId);
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
        const userId = ctx.state.userId as string;
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

        const defaultAlias = GEMINI_MODEL_ENV ?? 'flash';
        const modelId = resolveModel(modelAlias ?? defaultAlias);

        const userPrompt = buildPrompt(command as EditorCommand, prompt, instruction);

        log.info(MODULE, `generate command=${command} model=${modelId} promptLen=${prompt.length}`);

        try {
            const result = streamText({
                model: createModel(modelId),
                system: SYSTEM_PROMPT,
                prompt: userPrompt,
                abortSignal: ctx.req.socket
                    ? (AbortSignal as unknown as { fromEvent(target: NodeJS.EventEmitter, event: string): AbortSignal }).fromEvent?.(ctx.req.socket, 'close') ?? undefined
                    : undefined,
            });

            ctx.status = 200;
            ctx.set({
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
            });
            ctx.respond = false;

            const res = ctx.res;
            for await (const chunk of result.textStream) {
                if (res.destroyed) break;
                res.write(chunk);
            }
            res.end();
        } catch (err) {
            if (!ctx.res.headersSent) {
                ctx.status = 500;
                ctx.body = { error: err instanceof Error ? err.message : String(err) };
            } else {
                ctx.res.end();
            }
            log.error(MODULE, 'generate failed', { error: err instanceof Error ? err.message : String(err) });
        }
    });
}
