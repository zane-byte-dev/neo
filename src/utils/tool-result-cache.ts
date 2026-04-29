/**
 * tool-result-cache.ts — In-memory LRU cache for full tool_result payloads.
 *
 * Stream protocol truncates tool results for UI display. The full payload is
 * stored here keyed by a stable id so the client can fetch it on demand
 * (e.g. "expand" button). Cache is process-local and bounded.
 *
 * Also provides `smartTruncate()` — a replacement for naive `.slice(0, N)`
 * that preserves both head and tail and reports omitted char count.
 */

/** Total entries retained. Oldest entries evicted first (Map iteration order). */
const MAX_ENTRIES = 500;
/** Per-entry payload cap (2 MiB) to prevent memory blow-ups. */
const MAX_BYTES_PER_ENTRY = 2 * 1024 * 1024;

interface Entry {
    userId: string;
    toolName: string;
    result: string;
    createdAt: number;
}

const _cache = new Map<string, Entry>();

export function setToolResult(id: string, entry: Omit<Entry, 'createdAt'>): void {
    const stored = entry.result.length > MAX_BYTES_PER_ENTRY
        ? entry.result.slice(0, MAX_BYTES_PER_ENTRY)
        : entry.result;
    // Refresh position (LRU semantics via insertion-order Map)
    if (_cache.has(id)) _cache.delete(id);
    _cache.set(id, { ...entry, result: stored, createdAt: Date.now() });
    while (_cache.size > MAX_ENTRIES) {
        const firstKey = _cache.keys().next().value;
        if (firstKey === undefined) break;
        _cache.delete(firstKey);
    }
}

export function getToolResult(id: string): Entry | undefined {
    return _cache.get(id);
}

/** Reset — for tests. */
export function resetToolResultCache(): void {
    _cache.clear();
}

export interface SmartTruncateOptions {
    /** Soft target for the preview length, in chars. Default 800. */
    max?: number;
    /** Head chars kept when truncating. Default 500. */
    head?: number;
    /** Tail chars kept when truncating. Default 200. */
    tail?: number;
}

/**
 * Smart-truncate a tool result for streaming preview:
 *   - If `text.length <= max`, return as-is.
 *   - Otherwise keep `head` chars from the start + `tail` chars from the end
 *     and insert a marker reporting the omitted char count.
 */
export function smartTruncate(text: string, opts: SmartTruncateOptions = {}): string {
    const max = opts.max ?? 800;
    const head = opts.head ?? 500;
    const tail = opts.tail ?? 200;
    if (text.length <= max) return text;
    const omitted = text.length - head - tail;
    if (omitted <= 0) return text;
    return `${text.slice(0, head)}\n\n…[${omitted} chars omitted]…\n\n${text.slice(-tail)}`;
}
