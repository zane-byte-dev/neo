/**
 * semantic-store.ts — ADD-only JSONL store for durable semantic facts.
 *
 * Facts are never overwritten; conflicting later entries supersede earlier
 * ones at recall time (recency boost). Deduplication is a separate rollup
 * process (not yet implemented).
 *
 * Layout: {stateDir}/memory/semantic.jsonl
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseJsonLines } from '../utils/json.js';
import type { SemanticFact } from './types.js';

function storePath(stateDir: string): string {
    return join(stateDir, 'memory', 'semantic.jsonl');
}

export async function appendFact(stateDir: string, fact: SemanticFact): Promise<void> {
    await fs.mkdir(join(stateDir, 'memory'), { recursive: true });
    await fs.appendFile(storePath(stateDir), JSON.stringify(fact) + '\n', 'utf8');
}

export async function readFacts(stateDir: string): Promise<SemanticFact[]> {
    try {
        const raw = await fs.readFile(storePath(stateDir), 'utf8');
        return parseJsonLines<SemanticFact>(raw);
    } catch {
        return [];
    }
}
