/**
 * manager.ts — Top-level memory API.
 *
 * Usage:
 *   const hits = await memory.recall(workDir, query, { topK: 5, stateDir });
 *   await memory.rememberTurn(workDir, { sessionId, userMsg, assistantMsg }, stateDir);
 *   await memory.rememberFact(workDir, { text, category: 'preference' }, stateDir);
 *
 * Writes are fire-and-forget safe: call sites shouldn't await if they don't
 * care about completion (memory is best-effort).
 */
import { randomBytes } from 'node:crypto';
import { searchKnowledge } from '../indexing/search.js';
import { indexEpisodeCardRecord, indexSemanticFactRecord } from '../indexing/writers.js';
import { appendEpisode, readRecentEpisodes } from './episode-store.js';
import { appendFact, readFacts } from './semantic-store.js';
import { retrieve } from './retriever.js';
import { workingList } from './working-memory.js';
import { log } from '../utils/logger.js';
import type {
    EpisodeCard,
    MemoryItem,
    RecallHit,
    RecallOptions,
    SemanticFact,
} from './types.js';

function newId(tier: string): string {
    return `${tier}:${Date.now()}:${randomBytes(3).toString('hex')}`;
}

function trimRecallHits(hits: RecallHit[], opts: RecallOptions): RecallHit[] {
    const topK = opts.topK ?? 10;
    const budgetTokens = opts.budgetTokens;

    if (!budgetTokens) return hits.slice(0, topK);

    const result: RecallHit[] = [];
    let used = 0;
    for (const hit of hits) {
        const cost = Math.ceil(hit.item.text.length / 2);
        if (used + cost > budgetTokens) break;
        result.push(hit);
        used += cost;
        if (result.length >= topK) break;
    }
    return result;
}

function extractRole(tagsJson: string | null): 'user' | 'assistant' | undefined {
    if (!tagsJson) return undefined;
    try {
        const parsed = JSON.parse(tagsJson) as { role?: 'user' | 'assistant' };
        return parsed.role;
    } catch {
        return undefined;
    }
}

function toIndexedMemoryHit(
    hit: ReturnType<typeof searchKnowledge>[number],
    tier: 'episodic' | 'semantic',
): RecallHit {
    const role = extractRole(hit.tagsJson);
    const tierScore = tier === 'semantic' ? 2 : 1;
    return {
        item: {
            id: hit.documentId,
            tier,
            ts: new Date(hit.updatedAt).toISOString(),
            text: hit.text,
            meta: {
                sessionId: hit.sessionId ?? undefined,
                role,
                source: hit.sourcePath,
                weight: 1,
            },
        },
        score: hit.score * tierScore,
        signals: {
            indexed: hit.score,
            tier: tierScore,
        },
    };
}

export async function rememberTurn(
    workDir: string,
    params: {
        sessionId: string;
        userId?: string;
        userMsg: string;
        assistantMsg: string;
    },
    stateDir = workDir,
): Promise<void> {
    const { sessionId, userId, userMsg, assistantMsg } = params;
    const ts = new Date().toISOString();
    const base = { sessionId, userId };

    const userCard: EpisodeCard = {
        id: newId('episodic'),
        tier: 'episodic',
        ts,
        text: userMsg,
        meta: { ...base, role: 'user' },
    };
    const asstCard: EpisodeCard = {
        id: newId('episodic'),
        tier: 'episodic',
        ts,
        text: assistantMsg,
        meta: { ...base, role: 'assistant' },
    };
    try {
        await appendEpisode(stateDir, userCard);
        await appendEpisode(stateDir, asstCard);
    } catch (err) {
        log.warn('Memory', 'rememberTurn failed', { err: err instanceof Error ? err.message : String(err) });
        return;
    }

    try {
        indexEpisodeCardRecord(workDir, userCard);
        indexEpisodeCardRecord(workDir, asstCard);
    } catch (err) {
        log.warn('Memory', 'indexEpisodeCard failed', { err: err instanceof Error ? err.message : String(err) });
    }
}

export async function rememberFact(
    workDir: string,
    params: { text: string; category?: string; userId?: string; source?: string; entities?: string[] },
    stateDir = workDir,
): Promise<void> {
    const fact: SemanticFact = {
        id: newId('semantic'),
        tier: 'semantic',
        ts: new Date().toISOString(),
        text: params.text,
        meta: {
            userId: params.userId,
            source: params.source,
            entities: params.entities,
            category: params.category,
        },
    };
    try {
        await appendFact(stateDir, fact);
    } catch (err) {
        log.warn('Memory', 'rememberFact failed', { err: err instanceof Error ? err.message : String(err) });
        return;
    }

    try {
        indexSemanticFactRecord(workDir, fact);
    } catch (err) {
        log.warn('Memory', 'indexSemanticFact failed', { err: err instanceof Error ? err.message : String(err) });
    }
}

/**
 * Recall relevant items for a query. Merges episodic + semantic + working.
 * Returns ranked hits; caller decides how to render them.
 */
export async function recall(
    workDir: string,
    query: string,
    opts: RecallOptions & { sessionId?: string; stateDir?: string } = {},
): Promise<RecallHit[]> {
    const hits: RecallHit[] = [];
    const stateDir = opts.stateDir ?? workDir;

    const includeWorking = !opts.tiers || opts.tiers.includes('working');
    if (includeWorking && opts.sessionId) {
        hits.push(...retrieve(query, workingList(opts.sessionId), {
            ...opts,
            tiers: ['working'],
            topK: Math.max((opts.topK ?? 10) * 2, 10),
        }));
    }

    const includeEpisodic = !opts.tiers || opts.tiers.includes('episodic');
    if (includeEpisodic) {
        const indexedHits = searchKnowledge({
            workDir,
            query,
            kinds: ['memory_episodic'],
            limit: Math.max((opts.topK ?? 10) * 2, 10),
        }).map((hit) => toIndexedMemoryHit(hit, 'episodic'));

        if (indexedHits.length) {
            hits.push(...indexedHits);
        } else {
            try {
                const episodes = await readRecentEpisodes(stateDir, 6);
                hits.push(...retrieve(query, episodes, {
                    ...opts,
                    tiers: ['episodic'],
                    topK: Math.max((opts.topK ?? 10) * 2, 10),
                }));
            } catch { /* ignore */ }
        }
    }

    const includeSemantic = !opts.tiers || opts.tiers.includes('semantic');
    if (includeSemantic) {
        const indexedHits = searchKnowledge({
            workDir,
            query,
            kinds: ['memory_semantic'],
            limit: Math.max((opts.topK ?? 10) * 2, 10),
        }).map((hit) => toIndexedMemoryHit(hit, 'semantic'));

        if (indexedHits.length) {
            hits.push(...indexedHits);
        } else {
            try {
                const facts = await readFacts(stateDir);
                hits.push(...retrieve(query, facts, {
                    ...opts,
                    tiers: ['semantic'],
                    topK: Math.max((opts.topK ?? 10) * 2, 10),
                }));
            } catch { /* ignore */ }
        }
    }

    hits.sort((a, b) => b.score - a.score);
    return trimRecallHits(hits, opts);
}

/** Render recall hits as a prompt-injectable string (budget in tokens). */
export function renderHits(hits: RecallHit[]): string {
    if (!hits.length) return '';
    const lines: string[] = [];
    for (const h of hits) {
        const ts = h.item.ts.slice(0, 10);
        const tag = h.item.tier === 'semantic'
            ? '💡'
            : h.item.meta?.role === 'assistant' ? '🤖' : '👤';
        const src = h.item.meta?.sessionId ? ` @${h.item.meta.sessionId.slice(0, 6)}` : '';
        const body = h.item.text.trim().replace(/\s+/g, ' ').slice(0, 240);
        lines.push(`- ${tag} [${ts}${src}] ${body}`);
    }
    return lines.join('\n');
}
