/**
 * src/llm/model-factory.ts — Create an AI SDK LanguageModel for the configured model.
 *
 * Simplified: only DeepSeek (via Anthropic API compatibility) is supported.
 * To add a new provider, add a branch here and update model-registry.ts.
 */

import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDeepseekApiKey } from '../config.js';
import { resolveModelAlias } from './model-registry.js';

/** Resolve a short alias (e.g. "deepseek") to the canonical model ID. */
export function resolveModel(alias: string): string {
    return resolveModelAlias(alias);
}

/** Create an AI SDK LanguageModel for a given model id. */
export function createLanguageModel(modelId: string): LanguageModel {
    const deepseek = createAnthropic({
        apiKey: getDeepseekApiKey(),
        baseURL: 'https://api.deepseek.com/anthropic',
    });
    return deepseek(modelId);
}
