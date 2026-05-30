/**
 * src/llm/model-factory.ts — Shared AI SDK model factory.
 */

import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
    MODEL_ALIASES,
    OLLAMA_BASE_URL,
    getAnthropicApiKey,
    getClaudeCodeBaseUrl,
    getClaudeCodeToken,
    getDeepseekApiKey,
    getGeminiApiKey,
    getOpenAIApiKey,
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

/** Check if a model ID belongs to OpenAI (GPT family). */
export function isOpenAIModel(modelId: string): boolean {
    return modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-');
}

/** Check if a model ID belongs to Anthropic (Claude family). */
export function isAnthropicModel(modelId: string): boolean {
    return modelId.startsWith('claude-') && !modelId.startsWith('claude-code/');
}

/** Check if a model ID uses a Claude Code compatible endpoint. */
export function isClaudeCodeModel(modelId: string): boolean {
    return modelId.startsWith('claude-code/');
}

/** Create an AI SDK LanguageModel for a given model id. */
export function createLanguageModel(modelId: string): LanguageModel {
    if (isDeepSeekModel(modelId)) {
        const deepseek = createOpenAI({
            apiKey: getDeepseekApiKey(),
            baseURL: 'https://api.deepseek.com',
        });
        return deepseek.chat(modelId);
    }
    if (isOllamaModel(modelId)) {
        const ollama = createOpenAI({
            apiKey: 'ollama',
            baseURL: OLLAMA_BASE_URL,
        });
        return ollama.chat(modelId.replace('ollama/', ''));
    }
    if (isOpenAIModel(modelId)) {
        const openai = createOpenAI({ apiKey: getOpenAIApiKey() });
        return openai.chat(modelId);
    }
    if (isClaudeCodeModel(modelId)) {
        const baseURL = getClaudeCodeBaseUrl();
        const authToken = getClaudeCodeToken();
        if (!baseURL || !authToken) {
            throw new Error('CLAUDE_CODE_BASE_URL and CLAUDE_CODE_TOKEN are required for Claude Code models');
        }
        const claudeCode = createAnthropic({
            baseURL,
            authToken,
            name: 'claude-code',
        });
        return claudeCode(modelId.replace('claude-code/', ''));
    }
    if (isAnthropicModel(modelId)) {
        const anthropic = createAnthropic({ apiKey: getAnthropicApiKey() });
        return anthropic(modelId);
    }
    const google = createGoogleGenerativeAI({ apiKey: getGeminiApiKey() });
    return google(modelId);
}