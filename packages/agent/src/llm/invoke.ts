/**
 * src/llm/invoke.ts — Shared usage recording helpers for LLM calls.
 *
 * Both the internal agent (llm/client.ts) and the provider API
 * (services/ai-provider-service.ts) call the same underlying model and record
 * the same usage metrics.  This module extracts that shared logic so neither
 * path duplicates it.
 */

import type { LanguageModelUsage } from 'ai';
import { recordTokenUsage } from '../utils/token-tracker.js';
import { appendUsageRecord, estimateCost } from './cost.js';

export interface UsageNumbers {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/** Extract token counts from an AI SDK usage object. */
export function extractUsageNumbers(usage: LanguageModelUsage | undefined): UsageNumbers {
    const promptTokens = usage?.inputTokens ?? 0;
    const completionTokens = usage?.outputTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
}

export interface RecordUsageArgs {
    userId: string;
    stateDir: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    startedAt: number;
    caller: string;
    systemPrompt?: string;
    userPrompt?: string;
    sessionId?: string;
    reason?: string;
}

/**
 * Write token usage to both the in-memory token tracker and the per-user
 * usage.jsonl file.  Never throws — usage recording must not crash callers.
 */
export async function recordUsage(args: RecordUsageArgs): Promise<void> {
    recordTokenUsage({
        ts: new Date().toISOString(),
        model: args.model,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        caller: args.caller,
    });
    await appendUsageRecord({
        timestamp: Date.now(),
        userId: args.userId,
        model: args.model,
        reason: args.reason ?? 'fixed',
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        estimatedCost: estimateCost(args.model, args.promptTokens, args.completionTokens),
        durationMs: Date.now() - args.startedAt,
        caller: args.caller,
        sessionId: args.sessionId,
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
    }, args.stateDir).catch(() => { /* never crash over tracking */ });
}
