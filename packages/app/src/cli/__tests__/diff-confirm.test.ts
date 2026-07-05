import { describe, it, expect, vi } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { computeDiffLines, DiffConfirm } from '../diff-confirm.js';

const before = 'a\nb\nc\n';
const after = 'a\nB2\nc\n';

describe('computeDiffLines', () => {
    it('classifies added, removed and context lines', () => {
        const lines = computeDiffLines(before, after);
        const kinds = lines.reduce<Record<string, number>>((acc, l) => {
            acc[l.kind] = (acc[l.kind] ?? 0) + 1;
            return acc;
        }, {});
        expect(kinds.context).toBeGreaterThan(0);
        expect(kinds.add).toBeGreaterThan(0);
        expect(kinds.del).toBeGreaterThan(0);
        expect(lines.some((l) => l.kind === 'del' && l.text === 'b')).toBe(true);
        expect(lines.some((l) => l.kind === 'add' && l.text === 'B2')).toBe(true);
    });
});

describe('DiffConfirm.render', () => {
    it('renders header, diff body and footer within the given width', () => {
        const comp = new DiffConfirm('src/x.ts', computeDiffLines(before, after));
        const width = 40;
        const out = comp.render(width);
        // pi-tui contract: no rendered line may exceed the viewport width.
        for (const line of out) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        const joined = out.join('\n');
        expect(joined).toContain('Edit');
        expect(joined).toContain('approve');
    });

    it('resolves a decision from key input and ignores input afterwards', () => {
        const comp = new DiffConfirm('x', computeDiffLines(before, after));
        const spy = vi.fn();
        comp.onDecision = spy;
        comp.handleInput('a');
        expect(spy).toHaveBeenCalledWith('always');
        comp.handleInput('n');
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
