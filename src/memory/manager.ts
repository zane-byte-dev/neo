/**
 * manager.ts — Top-level memory API.
 *
 * Usage:
 *   const hits = await memory.recall(workDir, query, { topK: 5 });
 *   await memory.rememberTurn(workDir, { sessionId, userMsg, assistantMsg });
 *   await memory.rememberFact(workDir, { text, category: 'preference' });
 *
 * Writes are fire-and-forget safe: call sites shouldn't await if they don't
 * care about completion (memory is best-effort).
 */
import { randomBytes } from 'node:crypto';
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

export async function rememberTurn(
    workDir: string,
    params: {
        sessionId: string;
        userId?: string;
        userMsg: string;
        assistantMsg: string;
    },
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
        await appendEpisode(workDir, userCard);
        await appendEpisode(workDir, asstCard);
    } catch (err) {
        log.warn('Memory', 'rememberTurn failed', { err: err instanceof Error ? err.message : String(err) });
    }
}

export async function rememberFact(
    workDir: string,
    params: { text: string; category?: string; userId?: string; source?: string; entities?: string[] },
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
        await appendFact(workDir, fact);
    } catch (err) {
        log.warn('Memory', 'rememberFact failed', { err: err instanceof Error ? err.message : String(err) });
    }
}

/**
 * Recall relevant items for a query. Merges episodic + semantic + working.
 * Returns ranked hits; caller decides how to render them.
 */
export async function recall(
    workDir: string,
    query: string,
    opts: RecallOptions & { sessionId?: string } = {},
): Promise<RecallHit[]> {
    const pool: MemoryItem[] = [];
    try {
        const episodes = await readRecentEpisodes(workDir, 6);
        pool.push(...episodes);
    } catch { /* ignore */ }
    try {
        const facts = await readFacts(workDir);
        pool.push(...facts);
    } catch { /* ignore */ }
    if (opts.sessionId) pool.push(...workingList(opts.sessionId));

    return retrieve(query, pool, opts);
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
