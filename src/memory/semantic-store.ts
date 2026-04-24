/**
 * semantic-store.ts — ADD-only JSONL store for durable semantic facts.
 *
 * Facts are never overwritten; conflicting later entries supersede earlier
 * ones at recall time (recency boost). Deduplication is a separate rollup
 * process (not yet implemented).
 *
 * Layout: {workDir}/memory/semantic.jsonl
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { SemanticFact } from './types.js';

function storePath(workDir: string): string {
    return join(workDir, '.neo', 'memory', 'semantic.jsonl');
}

export async function appendFact(workDir: string, fact: SemanticFact): Promise<void> {
    await fs.mkdir(join(workDir, '.neo', 'memory'), { recursive: true });
    await fs.appendFile(storePath(workDir), JSON.stringify(fact) + '\n', 'utf8');
}

export async function readFacts(workDir: string): Promise<SemanticFact[]> {
    try {
        const raw = await fs.readFile(storePath(workDir), 'utf8');
        const out: SemanticFact[] = [];
        for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            try { out.push(JSON.parse(line) as SemanticFact); } catch { /* skip */ }
        }
        return out;
    } catch {
        return [];
    }
}
