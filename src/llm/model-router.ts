/**
 * src/llm/model-router.ts — Smart model selection.
 *
 * When the user selects "auto", this module picks the best available model
 * based on task characteristics and provider availability.
 *
 * Priority chain:
 *   1. User explicit selection (not "auto") → use as-is
 *   2. Task needs tools → DeepSeek (cheap, reliable tool-calling)
 *   3. Pure conversation / analysis → Gemini ACP (high quality, OAuth quota)
 *   4. ACP unavailable fallback → DeepSeek
 *   5. No cloud keys → Ollama Gemma (local)
 */

import { GEMINI_API_KEY, DEEPSEEK_API_KEY } from '../config.js';
import { isAcpAvailable } from './providers/gemini-acp.js';

export interface RouteOptions {
    /** The user's explicit model choice (alias). undefined or 'auto' = smart routing. */
    userModel?: string;
    /** Whether this turn will use tools (agent mode). */
    hasTools: boolean;
}

/**
 * Resolve the model alias to use for a given request.
 * Returns a short alias string (e.g. 'deepseek', 'gemini-acp', 'gemma', 'flash').
 */
export function resolveSmartModel(opts: RouteOptions): string | undefined {
    // Explicit user choice — pass through (undefined means "use LLMClient default")
    if (opts.userModel && opts.userModel !== 'auto') {
        return opts.userModel;
    }

    // ── Auto routing ──────────────────────────────────────────────────────

    // Tool-requiring tasks need a model with solid function-calling support.
    // DeepSeek is cheap and reliable for tool use.
    if (opts.hasTools) {
        if (DEEPSEEK_API_KEY) return 'deepseek';
        if (GEMINI_API_KEY) return 'flash';
        return 'gemma';  // fallback to local
    }

    // Pure conversation / analysis — prefer Gemini ACP (best quality, free quota)
    if (isAcpAvailable()) return 'gemini-acp';

    // ACP not available — use cloud providers
    if (GEMINI_API_KEY) return 'flash';
    if (DEEPSEEK_API_KEY) return 'deepseek';

    // Last resort: local model
    return 'gemma';
}
