/**
 * src/llm/model-router.ts — Resolve model alias for a request.
 */

export interface RouteOptions {
    userModel?: string;
}

export interface SmartRouteDecision {
    model: string;
    reason: string;
}

export function resolveSmartRoute(opts: RouteOptions): SmartRouteDecision {
    const model = opts.userModel && opts.userModel !== 'auto' ? opts.userModel : 'deepseek';
    return { model, reason: 'fixed' };
}
