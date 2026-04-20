export type Tier = 'simple' | 'standard' | 'complex';

export const ROUTING_CONFIG = {
    tiers: {
        simple: ['gemma', 'flash', 'gemini-acp'],
        standard: ['gemini-acp', 'flash', 'deepseek'],
        complex: ['deepseek-reasoner', 'pro', 'deepseek'],
    } satisfies Record<Tier, string[]>,
    boundaries: {
        simpleMax: -0.05,
        standardMax: 0.15,
    },
    overrides: {
        toolFloor: 'standard' as Tier,
        largeContextFloor: 'complex' as Tier,
        largeContextThreshold: 50_000,
    },
    fallback: {
        maxRetries: 1,
        retryableErrors: [429, 503, 'ETIMEDOUT', 'ECONNRESET'],
    },
    momentum: {
        historySize: 5,
        maxWeight: 0.3,
        messageThreshold: 100,
    },
    confidence: {
        k: 20,
        fallbackThreshold: 0.55,
    },
} as const;

export function getTierByScore(score: number): Tier {
    if (score < ROUTING_CONFIG.boundaries.simpleMax) return 'simple';
    if (score < ROUTING_CONFIG.boundaries.standardMax) return 'standard';
    return 'complex';
}

export function getTierRank(tier: Tier): number {
    if (tier === 'simple') return 0;
    if (tier === 'standard') return 1;
    return 2;
}

export function maxTier(a: Tier, b: Tier): Tier {
    return getTierRank(a) >= getTierRank(b) ? a : b;
}

export function getFallbackChain(primary: string, tier?: Tier): string[] {
    if (!tier) return [primary];
    const tierModels = ROUTING_CONFIG.tiers[tier];
    const idx = tierModels.indexOf(primary);
    if (idx < 0) return [primary];
    const chain = tierModels.slice(idx, idx + ROUTING_CONFIG.fallback.maxRetries + 1);
    return [...new Set(chain)];
}

