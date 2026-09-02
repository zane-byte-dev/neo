/**
 * src/runtime/events.ts — Append-only event log per run.
 *
 * Layout: {stateDir}/runs/{runId}/events.jsonl
 *
 * Each line is a {@link RunEvent}. Append uses a serialised in-process
 * queue per file path so that interleaved appendEvent() calls produce a
 * monotonically increasing `index` and never collide on the same line.
 *
 * Reads are cursor-based (`afterIndex`) so the chat SSE bridge and the
 * future `GET /api/runs/:id/events?cursor=N` route can share the same
 * primitive.
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateId } from '../utils/id-generator.js';
import { eventsFilePath } from './paths.js';
import type { RunEvent, RunEventType } from './types.js';

/** Per-event payload type extracted from the discriminated union. */
type PayloadOf<T extends RunEventType> = Extract<RunEvent, { type: T }>['payload'];

/** Optional fields callers may override (mainly for tests / replay). */
export interface AppendEventOptions {
    id?: string;
    ts?: string;
}

/**
 * Append a typed event to the run's `events.jsonl` and return the
 * persisted record (with assigned `index`).
 *
 * Concurrent calls for the same run are serialised via an internal
 * queue so the on-disk index sequence is gapless and ordered.
 */
export async function appendEvent<T extends RunEventType>(
    workDir: string,
    runId: string,
    type: T,
    payload: PayloadOf<T>,
    opts: AppendEventOptions = {},
): Promise<Extract<RunEvent, { type: T }>> {
    return _enqueue(eventsFilePath(workDir, runId), async () => {
        const path = eventsFilePath(workDir, runId);
        await mkdir(dirname(path), { recursive: true });
        const nextIndex = await _peekNextIndex(path);
        const event = {
            id: opts.id ?? `evt_${generateId()}`,
            runId,
            index: nextIndex,
            type,
            ts: opts.ts ?? new Date().toISOString(),
            payload,
        } as Extract<RunEvent, { type: T }>;
        await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
        return event;
    });
}

export interface ListEventsOptions {
    /** Return only events with `index` strictly greater than this cursor. */
    afterIndex?: number;
    /** Maximum number of events to return. Defaults to all. */
    limit?: number;
}

/**
 * Read the run's event log. Returns events in insertion order. Missing
 * files yield an empty list (rather than throwing) so callers do not
 * need to special-case fresh runs.
 */
export async function listRunEvents(
    workDir: string,
    runId: string,
    opts: ListEventsOptions = {},
): Promise<RunEvent[]> {
    const path = eventsFilePath(workDir, runId);
    if (!existsSync(path)) return [];
    const text = await readFile(path, 'utf8');
    const out: RunEvent[] = [];
    const after = opts.afterIndex ?? -1;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    for (const line of text.split('\n')) {
        if (!line) continue;
        let parsed: RunEvent | null = null;
        try {
            parsed = JSON.parse(line) as RunEvent;
        } catch {
            // Skip malformed line: append-only logs are append-tolerant.
            continue;
        }
        if (parsed.index <= after) continue;
        out.push(parsed);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Return the index of the most recently persisted event, or `-1` when
 * the log is empty. Useful for resume cursors.
 */
export async function lastEventIndex(workDir: string, runId: string): Promise<number> {
    const path = eventsFilePath(workDir, runId);
    if (!existsSync(path)) return -1;
    return _peekNextIndex(path).then((n) => n - 1);
}

/**
 * Remove high-volume text/thought llm_chunk events from the run's event
 * log once the run has reached a terminal state.  The final assistant
 * reply is persisted to chat history and is the source of truth; these
 * streaming-only events account for the bulk of on-disk usage and are
 * not needed afterwards.
 *
 * Also removes tool_call and tool_result llm_chunk events — the
 * structured tool_call_started / tool_call_finished events already
 * capture that information and are far more compact.
 *
 * Uses atomic-replace so a crash mid-write never leaves a corrupt file.
 * Missing files are silently ignored.  Malformed lines are kept as-is.
 */
export async function pruneTextChunkEvents(workDir: string, runId: string): Promise<void> {
    const path = eventsFilePath(workDir, runId);
    if (!existsSync(path)) return;
    const text = await readFile(path, 'utf8');
    const lines = text.split('\n');
    const kept: string[] = [];
    let pruned = 0;
    for (const line of lines) {
        if (!line) continue;
        try {
            const parsed = JSON.parse(line) as RunEvent;
            if (parsed.type === 'llm_chunk') {
                const ct = parsed.payload.chunkType;
                if (ct === 'text' || ct === 'thought' || ct === 'tool_call' || ct === 'tool_result') {
                    pruned += 1;
                    continue;
                }
            }
        } catch {
            // Malformed line: keep it as-is.
        }
        kept.push(line);
    }
    if (pruned === 0) return;
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, kept.join('\n') + '\n', 'utf8');
    await rename(tmp, path);
}

// ── internals ──────────────────────────────────────────────────────────

const _writeQueues = new Map<string, Promise<unknown>>();

/** Serialise async callbacks per file path. */
function _enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = _writeQueues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    _writeQueues.set(key, next.catch(() => undefined));
    return next as Promise<T>;
}

async function _peekNextIndex(path: string): Promise<number> {
    if (!existsSync(path)) return 0;
    // Scan the tail; the file is line-delimited and grows by single lines.
    const text = await readFile(path, 'utf8');
    let lastIndex = -1;
    for (const line of text.split('\n')) {
        if (!line) continue;
        try {
            const parsed = JSON.parse(line) as { index?: number };
            if (typeof parsed.index === 'number' && parsed.index > lastIndex) {
                lastIndex = parsed.index;
            }
        } catch {
            // ignore malformed lines
        }
    }
    return lastIndex + 1;
}
