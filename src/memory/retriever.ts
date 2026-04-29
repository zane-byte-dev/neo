/**
 * retriever.ts — BM25-lite multi-signal retriever over MemoryItems.
 *
 * Signals:
 *   1. BM25 score on tokenized text
 *   2. Recency boost: log-decay on age
 *   3. Tier bias: semantic > episodic > working by default
 *
 * This is a pure in-memory retriever — rebuild-on-read. Fine for
 * per-user corpora under ~50k items; swap in a real index later if needed.
 */
import { tokenize } from './tokenize.js';
import type { MemoryItem, MemoryTier, RecallHit, RecallOptions } from './types.js';

const TIER_BIAS: Record<MemoryTier, number> = {
    semantic: 2.0,
    episodic: 1.0,
    working:  0.8,
};

interface IndexedDoc {
    item: MemoryItem;
    tokens: string[];
    tf: Map<string, number>;
    len: number;
}

function buildIndex(items: MemoryItem[]): { docs: IndexedDoc[]; df: Map<string, number>; avgLen: number } {
    const docs: IndexedDoc[] = items.map((item) => {
        const tokens = tokenize(item.text);
        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        return { item, tokens, tf, len: tokens.length };
    });
    const df = new Map<string, number>();
    for (const d of docs) {
        for (const term of d.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    }
    const avgLen = docs.length ? docs.reduce((s, d) => s + d.len, 0) / docs.length : 1;
    return { docs, df, avgLen };
}

function bm25(
    doc: IndexedDoc,
    queryTerms: string[],
    df: Map<string, number>,
    N: number,
    avgLen: number,
): number {
    const k1 = 1.5;
    const b  = 0.75;
    let score = 0;
    for (const q of queryTerms) {
        const f = doc.tf.get(q);
        if (!f) continue;
        const n = df.get(q) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / avgLen));
        score += idf * tfNorm;
    }
    return score;
}

function recencyBoost(tsISO: string, now = Date.now()): number {
    const t = Date.parse(tsISO);
    if (!Number.isFinite(t)) return 1;
    const ageDays = Math.max(0, (now - t) / 86_400_000);
    // 1.0 today → 0.5 at ~30 days (log-decay)
    return 1 / (1 + Math.log1p(ageDays) / Math.log1p(30));
}

export function retrieve(
    query: string,
    items: MemoryItem[],
    opts: RecallOptions = {},
): RecallHit[] {
    const { topK = 10, tiers } = opts;
    const pool = tiers?.length ? items.filter((i) => tiers.includes(i.tier)) : items;
    if (!pool.length) return [];

    const { docs, df, avgLen } = buildIndex(pool);
    const queryTerms = tokenize(query);
    if (!queryTerms.length) return [];

    const N = docs.length;
    const now = Date.now();
    const hits: RecallHit[] = [];
    for (const d of docs) {
        const bm = bm25(d, queryTerms, df, N, avgLen);
        if (bm <= 0) continue;
        const rec = recencyBoost(d.item.ts, now);
        const tier = TIER_BIAS[d.item.tier] ?? 1;
        const weight = d.item.meta?.weight ?? 1;
        const score = bm * rec * tier * weight;
        hits.push({
            item: d.item,
            score,
            signals: { bm25: bm, recency: rec, tier, weight },
        });
    }
    hits.sort((a, b) => b.score - a.score);

    const { budgetTokens } = opts;
    if (budgetTokens) {
        const result: RecallHit[] = [];
        let used = 0;
        for (const h of hits) {
            // rough token estimate = characters / 2 (CJK heavy)
            const cost = Math.ceil(h.item.text.length / 2);
            if (used + cost > budgetTokens) break;
            result.push(h);
            used += cost;
            if (result.length >= topK) break;
        }
        return result;
    }
    return hits.slice(0, topK);
}
