export type Tier = 'simple' | 'standard' | 'complex';

export interface RoutingConfig {
    tiers: Record<Tier, string[]>;
    boundaries: { simpleMax: number; standardMax: number };
    overrides: { toolFloor: Tier; largeContextFloor: Tier; largeContextThreshold: number };
    fallback: { maxRetries: number; retryableErrors: Array<number | string> };
    momentum: { historySize: number; maxWeight: number; messageThreshold: number };
    confidence: { k: number; fallbackThreshold: number };
}

const DEFAULTS: RoutingConfig = {
    tiers: {
        simple: ['gemma', 'flash', 'gemini-acp'],
        standard: ['gemini-acp', 'flash', 'deepseek'],
        complex: ['deepseek-reasoner', 'pro', 'deepseek'],
    },
    boundaries: {
        simpleMax: -0.05,
        standardMax: 0.15,
    },
    overrides: {
        toolFloor: 'standard',
        largeContextFloor: 'complex',
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
};

/** Live, mutable routing config. Modules read fields from this object directly. */
export const ROUTING_CONFIG: RoutingConfig = structuredClone(DEFAULTS);

export function getDefaultRoutingConfig(): RoutingConfig {
    return structuredClone(DEFAULTS);
}

/** Deep-merge a partial override into ROUTING_CONFIG (in place). */
export function applyRoutingOverride(partial: Partial<RoutingConfig> | null | undefined): void {
    if (!partial || typeof partial !== 'object') return;
    if (partial.tiers && typeof partial.tiers === 'object') {
        for (const tier of ['simple', 'standard', 'complex'] as Tier[]) {
            const next = partial.tiers[tier];
            if (Array.isArray(next) && next.every((m) => typeof m === 'string')) {
                ROUTING_CONFIG.tiers[tier] = [...next];
            }
        }
    }
    if (partial.boundaries) {
        if (typeof partial.boundaries.simpleMax === 'number') {
            ROUTING_CONFIG.boundaries.simpleMax = partial.boundaries.simpleMax;
        }
        if (typeof partial.boundaries.standardMax === 'number') {
            ROUTING_CONFIG.boundaries.standardMax = partial.boundaries.standardMax;
        }
    }
    if (partial.overrides) {
        const t = partial.overrides.toolFloor;
        if (t === 'simple' || t === 'standard' || t === 'complex') ROUTING_CONFIG.overrides.toolFloor = t;
        const c = partial.overrides.largeContextFloor;
        if (c === 'simple' || c === 'standard' || c === 'complex') ROUTING_CONFIG.overrides.largeContextFloor = c;
        if (typeof partial.overrides.largeContextThreshold === 'number' && partial.overrides.largeContextThreshold > 0) {
            ROUTING_CONFIG.overrides.largeContextThreshold = partial.overrides.largeContextThreshold;
        }
    }
    if (partial.confidence) {
        if (typeof partial.confidence.k === 'number') ROUTING_CONFIG.confidence.k = partial.confidence.k;
        if (typeof partial.confidence.fallbackThreshold === 'number') {
            ROUTING_CONFIG.confidence.fallbackThreshold = partial.confidence.fallbackThreshold;
        }
    }
    if (partial.momentum) {
        if (typeof partial.momentum.historySize === 'number' && partial.momentum.historySize >= 0) {
            ROUTING_CONFIG.momentum.historySize = Math.floor(partial.momentum.historySize);
        }
        if (typeof partial.momentum.maxWeight === 'number') ROUTING_CONFIG.momentum.maxWeight = partial.momentum.maxWeight;
        if (typeof partial.momentum.messageThreshold === 'number') {
            ROUTING_CONFIG.momentum.messageThreshold = partial.momentum.messageThreshold;
        }
    }
}

/** Reset ROUTING_CONFIG back to baked-in defaults. */
export function resetRoutingConfig(): void {
    const fresh = getDefaultRoutingConfig();
    ROUTING_CONFIG.tiers = fresh.tiers;
    ROUTING_CONFIG.boundaries = fresh.boundaries;
    ROUTING_CONFIG.overrides = fresh.overrides;
    ROUTING_CONFIG.fallback = fresh.fallback;
    ROUTING_CONFIG.momentum = fresh.momentum;
    ROUTING_CONFIG.confidence = fresh.confidence;
}

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
    // maxRetries is retry count; chain includes primary + retry targets.
    const chain = tierModels.slice(idx, idx + ROUTING_CONFIG.fallback.maxRetries + 1);
    return [...new Set(chain)];
}
