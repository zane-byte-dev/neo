/**
 * src/llm/model-factory.ts — Create an AI SDK LanguageModel for the configured model.
 *
 * Simplified: only DeepSeek (via Anthropic API compatibility) is supported.
 * To add a new provider, add a branch here and update MODEL_ALIASES in config.ts.
 */

import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { MODEL_ALIASES, getDeepseekApiKey } from '../config.js';

/** Resolve a short alias (e.g. "deepseek") to the canonical model ID. */
export function resolveModel(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

/** Create an AI SDK LanguageModel for a given model id. */
export function createLanguageModel(modelId: string): LanguageModel {
    const deepseek = createAnthropic({
        apiKey: getDeepseekApiKey(),
        baseURL: 'https://api.deepseek.com/anthropic',
    });
    return deepseek(modelId);
}
