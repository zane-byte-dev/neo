/**
 * Memory system — unified abstraction for Neo's tiered memory.
 *
 * Tiers:
 *   - Working Memory  (in-process, per session)     — ephemeral scratchpad
 *   - Episodic Memory (JSONL, per month shard)      — conversation turns + summaries
 *   - Semantic Memory (JSONL, ADD-only)             — durable facts / preferences
 *
 * This module is deliberately dependency-free: it uses the existing
 * filesystem layout and an in-memory inverted index for retrieval. A
 * vector-backed retriever can be slotted in later behind the same
 * `MemoryManager.recall()` interface.
 */

export type MemoryTier = 'working' | 'episodic' | 'semantic';

export interface MemoryItem {
    /** Stable id — `${tier}:${timestamp}:${hash}` */
    id: string;
    tier: MemoryTier;
    /** ISO timestamp of creation */
    ts: string;
    /** Free-form content (markdown / plain) */
    text: string;
    /** Optional structured metadata */
    meta?: {
        sessionId?: string;
        userId?: string;
        role?: 'user' | 'assistant';
        entities?: string[];
        /** Source path for provenance (e.g. notebook file, chat session) */
        source?: string;
        /** Confidence / decay weight (0..1), default 1 */
        weight?: number;
    };
}

export interface EpisodeCard extends MemoryItem {
    tier: 'episodic';
    meta: NonNullable<MemoryItem['meta']> & {
        sessionId: string;
        role: 'user' | 'assistant';
    };
}

export interface SemanticFact extends MemoryItem {
    tier: 'semantic';
    meta: NonNullable<MemoryItem['meta']> & {
        /** Category hint — "preference" | "fact" | "goal" | "event" | …  */
        category?: string;
    };
}

export interface RecallHit {
    item: MemoryItem;
    /** Combined relevance score (higher is better) */
    score: number;
    /** Per-signal breakdown for debugging */
    signals: Record<string, number>;
}

export interface RecallOptions {
    /** Max number of results */
    topK?: number;
    /** Rough token budget — retriever trims until under budget */
    budgetTokens?: number;
    /** Limit to certain tiers */
    tiers?: MemoryTier[];
}
