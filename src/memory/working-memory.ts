/**
 * working-memory.ts — Per-session ephemeral scratchpad.
 *
 * Lives in-process only. Use for within-turn notes that shouldn't leak
 * across sessions or survive a restart. For persistence, promote to
 * episodic or semantic.
 */
import type { MemoryItem } from './types.js';

const _store = new Map<string, MemoryItem[]>(); // sessionId → items

export function workingAppend(sessionId: string, item: MemoryItem): void {
    if (!_store.has(sessionId)) _store.set(sessionId, []);
    _store.get(sessionId)!.push(item);
}

export function workingList(sessionId: string): MemoryItem[] {
    return _store.get(sessionId) ?? [];
}

export function workingClear(sessionId: string): void {
    _store.delete(sessionId);
}
