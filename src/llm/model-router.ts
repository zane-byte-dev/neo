/**
 * src/llm/model-router.ts — Resolve model alias for a request.
 *
 * Simplified: always uses DeepSeek. No scorer, no tier routing.
 */

export interface RouteOptions {
    userModel?: string;
    hasTools?: boolean;
    message?: string;
    conversationDepth?: number;
    toolCount?: number;
    totalContextTokens?: number;
}

export interface SmartRouteDecision {
    model: string;
    tier: string;
    score: number;
    confidence: number;
    reason: string;
    dimensions: Record<string, number>;
    fallbackChain: string[];
}

/**
 * Check if a model alias is available for use.
 * Currently only `deepseek` is supported — returns true if an API key is configured.
 */
export function isModelAliasAvailable(_alias: string): boolean {
    // DeepSeek is always available when the app is running (API key checked at startup).
    return true;
}

export function resolveSmartRoute(opts: RouteOptions): SmartRouteDecision {
    const model = opts.userModel && opts.userModel !== 'auto' ? opts.userModel : 'deepseek';
    return {
        model,
        tier: 'standard',
        score: 0,
        confidence: 1,
        reason: 'fixed',
        dimensions: {},
        fallbackChain: [model],
    };
}

export function resolveSmartModel(opts: RouteOptions): string | undefined {
    return resolveSmartRoute(opts).model;
}
