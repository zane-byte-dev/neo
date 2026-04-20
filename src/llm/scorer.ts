import {
    ANALYTICAL_REASONING_KEYWORDS,
    CODE_GENERATION_KEYWORDS,
    CONSTRAINT_KEYWORDS,
    MULTI_STEP_KEYWORDS,
    SIMPLE_INDICATORS,
} from './scorer-keywords.js';
import { ROUTING_CONFIG, getTierByScore, maxTier, type Tier } from './routing-config.js';

export interface ScorerInput {
    message: string;
    conversationDepth: number;
    toolCount: number;
    hasTools: boolean;
    totalContextTokens?: number;
    recentTiers?: Tier[];
}

export interface ScorerDimensions {
    simpleIndicators: number;
    codeGeneration: number;
    multiStep: number;
    analyticalReasoning: number;
    tokenCount: number;
    constraintDensity: number;
    toolCount: number;
    conversationDepth: number;
}

export interface ScorerResult {
    tier: Tier;
    score: number;
    confidence: number;
    reason: string;
    dimensions: ScorerDimensions;
}

const WEIGHTS = {
    simpleIndicators: 0.10,
    codeGeneration: 0.08,
    multiStep: 0.08,
    analyticalReasoning: 0.07,
    tokenCount: 0.06,
    constraintDensity: 0.04,
    toolCount: 0.05,
    conversationDepth: 0.04,
} as const;

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function countHits(text: string, keywords: string[]): number {
    let hits = 0;
    for (const kw of keywords) {
        if (text.includes(kw)) hits++;
    }
    return hits;
}

function keywordScore(text: string, keywords: string[]): number {
    const hits = countHits(text, keywords);
    return clamp(hits / 3, 0, 1);
}

function tokenCountScore(text: string): number {
    const estimatedTokens = text.length / 4;
    if (estimatedTokens < 50) return -0.5;
    if (estimatedTokens > 500) return 0.5;
    return ((estimatedTokens - 50) / 450) - 0.5;
}

function constraintDensityScore(text: string): number {
    const hits = countHits(text, CONSTRAINT_KEYWORDS);
    const estimatedTokens = Math.max(1, text.length / 4);
    return clamp((hits / estimatedTokens) * 20, 0, 1);
}

function toolCountScore(toolCount: number): number {
    if (toolCount <= 0) return 0;
    if (toolCount <= 5) return 0.3;
    if (toolCount > 10) return 0.9;
    return 0.3 + ((toolCount - 5) / 5) * 0.6;
}

function conversationDepthScore(depth: number): number {
    if (depth <= 2) return 0;
    if (depth <= 10) return 0.3;
    if (depth > 20) return 0.7;
    return 0.3 + ((depth - 10) / 10) * 0.4;
}

function hasComplexKeyword(text: string): boolean {
    return (
        countHits(text, CODE_GENERATION_KEYWORDS) > 0
        || countHits(text, MULTI_STEP_KEYWORDS) > 0
        || countHits(text, ANALYTICAL_REASONING_KEYWORDS) > 0
        || countHits(text, CONSTRAINT_KEYWORDS) > 0
    );
}

function minDistanceToBoundary(score: number): number {
    const d1 = Math.abs(score - ROUTING_CONFIG.boundaries.simpleMax);
    const d2 = Math.abs(score - ROUTING_CONFIG.boundaries.standardMax);
    return Math.min(d1, d2);
}

function calcConfidence(score: number): number {
    const x = ROUTING_CONFIG.confidence.k * minDistanceToBoundary(score);
    return 1 / (1 + Math.exp(-x));
}

function applyMomentum(baseTier: Tier, input: ScorerInput): Tier {
    const recent = (input.recentTiers ?? []).slice(-ROUTING_CONFIG.momentum.historySize);
    if (!recent.length) return baseTier;
    if (input.message.length >= ROUTING_CONFIG.momentum.messageThreshold) return baseTier;
    const first = recent[0];
    if (!recent.every((t) => t === first)) return baseTier;
    return first;
}

export function scoreRequest(input: ScorerInput): ScorerResult {
    const text = input.message.toLowerCase();

    if (input.message.length < 40 && !hasComplexKeyword(text)) {
        const tier = maxTier('simple', input.hasTools ? ROUTING_CONFIG.overrides.toolFloor : 'simple');
        return {
            tier,
            score: -0.2,
            confidence: 0.8,
            reason: 'short_message',
            dimensions: {
                simpleIndicators: keywordScore(text, SIMPLE_INDICATORS),
                codeGeneration: 0,
                multiStep: 0,
                analyticalReasoning: 0,
                tokenCount: tokenCountScore(text),
                constraintDensity: 0,
                toolCount: toolCountScore(input.toolCount),
                conversationDepth: conversationDepthScore(input.conversationDepth),
            },
        };
    }

    const dimensions: ScorerDimensions = {
        simpleIndicators: keywordScore(text, SIMPLE_INDICATORS),
        codeGeneration: keywordScore(text, CODE_GENERATION_KEYWORDS),
        multiStep: keywordScore(text, MULTI_STEP_KEYWORDS),
        analyticalReasoning: keywordScore(text, ANALYTICAL_REASONING_KEYWORDS),
        tokenCount: tokenCountScore(text),
        constraintDensity: constraintDensityScore(text),
        toolCount: toolCountScore(input.toolCount),
        conversationDepth: conversationDepthScore(input.conversationDepth),
    };

    const score = (
        dimensions.simpleIndicators * WEIGHTS.simpleIndicators * -1
        + dimensions.codeGeneration * WEIGHTS.codeGeneration
        + dimensions.multiStep * WEIGHTS.multiStep
        + dimensions.analyticalReasoning * WEIGHTS.analyticalReasoning
        + dimensions.tokenCount * WEIGHTS.tokenCount
        + dimensions.constraintDensity * WEIGHTS.constraintDensity
        + dimensions.toolCount * WEIGHTS.toolCount
        + dimensions.conversationDepth * WEIGHTS.conversationDepth
    );

    const baseTier = getTierByScore(score);
    let tier = applyMomentum(baseTier, input);
    let reason = tier !== baseTier ? 'momentum_override' : 'scored';

    if (input.hasTools) {
        tier = maxTier(tier, ROUTING_CONFIG.overrides.toolFloor);
        reason = 'tool_detected';
    }
    if ((input.totalContextTokens ?? 0) > ROUTING_CONFIG.overrides.largeContextThreshold) {
        tier = maxTier(tier, ROUTING_CONFIG.overrides.largeContextFloor);
        reason = 'large_context';
    }

    const confidence = calcConfidence(score);
    if (confidence < ROUTING_CONFIG.confidence.fallbackThreshold) {
        tier = 'standard';
        reason = 'low_confidence';
    }

    return {
        tier,
        score,
        confidence,
        reason,
        dimensions,
    };
}
