/**
 * src/llm/model-factory.ts — Shared AI SDK model factory.
 */

import type { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
    MODEL_ALIASES,
    OLLAMA_BASE_URL,
    getDeepseekApiKey,
} from '../config.js';

/** Resolve a short alias (e.g. "flash") to the canonical model ID. */
export function resolveModel(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

/** Check if a model ID belongs to the DeepSeek provider. */
export function isDeepSeekModel(modelId: string): boolean {
    return modelId.startsWith('deepseek');
}

/** Check if a model ID belongs to a local Ollama instance. */
export function isOllamaModel(modelId: string): boolean {
    return modelId.startsWith('ollama/');
}

/** Check if a model ID uses the Gemini CLI ACP provider. */
export function isAcpModel(modelId: string): boolean {
    return modelId.startsWith('acp/');
}

/** Create an AI SDK LanguageModel for a given model id. */
export function createLanguageModel(modelId: string): LanguageModel {
    if (isDeepSeekModel(modelId)) {
        const deepseek = createAnthropic({
            apiKey: getDeepseekApiKey(),
            baseURL: 'https://api.deepseek.com/anthropic',
        });
        return deepseek(modelId);
    }
    if (isOllamaModel(modelId)) {
        const ollama = createOpenAI({
            apiKey: 'ollama',
            baseURL: OLLAMA_BASE_URL,
        });
        return ollama.chat(modelId.replace('ollama/', ''));
    }
    throw new Error(`Unsupported model: ${modelId}`);
}