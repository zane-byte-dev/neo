/**
 * src/llm/model-router.ts — Config-driven smart routing.
 */

import { GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY } from '../config.js';
import { isAcpAvailable } from './providers/gemini-acp.js';
import { scoreRequest, type ScorerDimensions } from './scorer.js';
import { getFallbackChain, ROUTING_CONFIG, type Tier } from './routing-config.js';

export interface RouteOptions {
    /** The user's explicit model choice (alias). undefined or 'auto' = smart routing. */
    userModel?: string;
    /** Whether this turn will use tools (agent mode). */
    hasTools: boolean;
    /** Current user message. */
    message?: string;
    /** Total history turn count. */
    conversationDepth?: number;
    /** Number of available tools. */
    toolCount?: number;
    /** Estimated context tokens. */
    totalContextTokens?: number;
    /** Recent route history for momentum. */
    recentTiers?: Tier[];
}

export interface SmartRouteDecision {
    model: string;
    tier: Tier;
    score: number;
    confidence: number;
    reason: string;
    dimensions: ScorerDimensions;
    fallbackChain: string[];
}

function isModelAliasAvailable(alias: string): boolean {
    if (alias === 'gemini-acp') return isAcpAvailable();
    if (alias === 'flash' || alias === 'pro') return Boolean(GEMINI_API_KEY);
    if (alias === 'deepseek' || alias === 'deepseek-chat' || alias === 'deepseek-reasoner') return Boolean(DEEPSEEK_API_KEY);
    if (alias === 'gemma') return true;
    if (alias === 'gpt' || alias.startsWith('gpt-')) return Boolean(OPENAI_API_KEY);
    if (alias === 'claude' || alias.startsWith('claude-')) return Boolean(ANTHROPIC_API_KEY);
    return true;
}

function pickTierModel(tier: Tier): string {
    const chain = ROUTING_CONFIG.tiers[tier];
    return chain.find((m) => isModelAliasAvailable(m)) ?? 'gemma';
}

export function resolveSmartRoute(opts: RouteOptions): SmartRouteDecision {
    if (opts.userModel && opts.userModel !== 'auto') {
        return {
            model: opts.userModel,
            tier: 'standard',
            score: 0,
            confidence: 1,
            reason: 'user_selected',
            dimensions: {
                simpleIndicators: 0,
                codeGeneration: 0,
                multiStep: 0,
                analyticalReasoning: 0,
                tokenCount: 0,
                constraintDensity: 0,
                toolCount: 0,
                conversationDepth: 0,
            },
            fallbackChain: [opts.userModel],
        };
    }

    const scored = scoreRequest({
        message: opts.message ?? '',
        conversationDepth: opts.conversationDepth ?? 0,
        toolCount: opts.toolCount ?? 0,
        hasTools: opts.hasTools,
        totalContextTokens: opts.totalContextTokens,
        recentTiers: opts.recentTiers,
    });
    const model = pickTierModel(scored.tier);
    return {
        model,
        tier: scored.tier,
        score: scored.score,
        confidence: scored.confidence,
        reason: scored.reason,
        dimensions: scored.dimensions,
        fallbackChain: getFallbackChain(model, scored.tier),
    };
}

/**
 * Resolve the model alias to use for a given request.
 * Returns a short alias string (e.g. 'deepseek', 'gemini-acp', 'gemma', 'flash').
 */
export function resolveSmartModel(opts: RouteOptions): string | undefined {
    return resolveSmartRoute(opts).model;
}
