/**
 * notebook-citation-registry.ts — Per-run in-memory map of citation index → source metadata.
 *
 * Workflow:
 *   1. `notebook_search` tool registers passages it returns to the LLM with
 *      stable numeric labels 【1】【2】... within a single agent run.
 *   2. After the run finishes streaming, the agent runner parses the final
 *      assistant text for 【N】 markers and consults this registry to build the
 *      ParsedCitation[] payload for the client / persistence.
 *   3. Registry entries are released when the run finalizes.
 */

export interface CitationEntry {
    n: number;
    sourceId: string;
    title: string;
    snippet?: string;
    chunkId?: string;
    charStart?: number;
    charEnd?: number;
}

interface RunRegistry {
    /** Stable mapping sourceId → assigned N. Re-uses N across multiple search calls. */
    bySourceId: Map<string, CitationEntry>;
    nextN: number;
}

const registries = new Map<string, RunRegistry>();

function getOrCreate(runId: string): RunRegistry {
    let reg = registries.get(runId);
    if (!reg) {
        reg = { bySourceId: new Map(), nextN: 1 };
        registries.set(runId, reg);
    }
    return reg;
}

/**
 * Register a passage and return its stable citation number for this run.
 * If the same sourceId has been seen before, returns the previously-assigned N
 * (and refreshes any newer snippet metadata).
 */
export function registerCitation(
    runId: string,
    entry: Omit<CitationEntry, 'n'>,
): number {
    const reg = getOrCreate(runId);
    const existing = reg.bySourceId.get(entry.sourceId);
    if (existing) {
        // Refresh metadata if newer hit gives more detail
        if (entry.snippet && !existing.snippet) existing.snippet = entry.snippet;
        if (entry.chunkId && !existing.chunkId) existing.chunkId = entry.chunkId;
        return existing.n;
    }
    const n = reg.nextN++;
    reg.bySourceId.set(entry.sourceId, { ...entry, n });
    return n;
}

/**
 * Read all citations referenced by a final assistant text. Scans for 【N】 markers
 * and returns the matching registry entries (deduped, ordered by N).
 */
export function citationsFromText(runId: string, text: string): CitationEntry[] {
    const reg = registries.get(runId);
    if (!reg) return [];
    const seen = new Set<number>();
    for (const m of text.matchAll(/【\s*(\d+)(?:\s*[:：][^】]*)?\s*】/g)) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) seen.add(n);
    }
    if (seen.size === 0) return [];
    const out: CitationEntry[] = [];
    for (const entry of reg.bySourceId.values()) {
        if (seen.has(entry.n)) out.push(entry);
    }
    out.sort((a, b) => a.n - b.n);
    return out;
}

/** Drop the registry for a finished run. Always safe to call. */
export function disposeRegistry(runId: string): void {
    registries.delete(runId);
}
