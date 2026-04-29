/**
 * episode-store.ts — JSONL-backed episodic memory, sharded by month.
 *
 * Layout: {stateDir}/memory/episodes/YYYY-MM.jsonl
 * Each line is a serialized `EpisodeCard`.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseJsonLines } from '../utils/json.js';
import type { EpisodeCard } from './types.js';

function shardPath(stateDir: string, iso: string): string {
    // iso = 2026-04-21T10:11:12.000Z → 2026-04
    const month = iso.slice(0, 7);
    return join(stateDir, 'memory', 'episodes', `${month}.jsonl`);
}

export async function appendEpisode(stateDir: string, card: EpisodeCard): Promise<void> {
    const p = shardPath(stateDir, card.ts);
    await fs.mkdir(join(stateDir, 'memory', 'episodes'), { recursive: true });
    await fs.appendFile(p, JSON.stringify(card) + '\n', 'utf8');
}

async function readEpisodeShards(stateDir: string, limit?: number): Promise<EpisodeCard[]> {
    const dir = join(stateDir, 'memory', 'episodes');
    let entries: string[];
    try {
        entries = (await fs.readdir(dir)).filter((n) => n.endsWith('.jsonl'));
    } catch {
        return [];
    }
    entries.sort().reverse();
    const picked = limit === undefined ? entries : entries.slice(0, limit);
    const out: EpisodeCard[] = [];
    for (const name of picked) {
        try {
            const raw = await fs.readFile(join(dir, name), 'utf8');
            out.push(...parseJsonLines<EpisodeCard>(raw));
        } catch { /* skip shard */ }
    }
    return out;
}

/** Read episodes within the last `months` shards (default: last 6 months). */
export async function readRecentEpisodes(stateDir: string, months = 6): Promise<EpisodeCard[]> {
    return readEpisodeShards(stateDir, months);
}

export async function readAllEpisodes(stateDir: string): Promise<EpisodeCard[]> {
    return readEpisodeShards(stateDir);
}
