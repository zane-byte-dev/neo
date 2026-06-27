import { describe, it, expect } from 'vitest';
import { workingAppend, workingList, workingClear } from '../working-memory.js';
import type { MemoryItem } from '../types.js';

function item(text: string): MemoryItem {
    return {
        id: `id-${text}`,
        tier: 'working',
        ts: new Date().toISOString(),
        text,
    } as MemoryItem;
}

describe('working-memory', () => {
    it('appends items and returns them in order', () => {
        const sid = `s-${Math.random()}`;
        workingAppend(sid, item('a'));
        workingAppend(sid, item('b'));
        const list = workingList(sid);
        expect(list.map((i) => i.text)).toEqual(['a', 'b']);
    });

    it('returns empty array for unknown session', () => {
        expect(workingList(`unknown-${Math.random()}`)).toEqual([]);
    });

    it('isolates sessions', () => {
        const s1 = `iso-1-${Math.random()}`;
        const s2 = `iso-2-${Math.random()}`;
        workingAppend(s1, item('x'));
        expect(workingList(s2)).toEqual([]);
    });

    it('clear removes the session bucket', () => {
        const sid = `c-${Math.random()}`;
        workingAppend(sid, item('keep-then-drop'));
        workingClear(sid);
        expect(workingList(sid)).toEqual([]);
    });
});
