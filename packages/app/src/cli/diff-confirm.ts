import { diffLines } from 'diff';
import { truncateToWidth, matchesKey, Key } from '@earendil-works/pi-tui';
import type { Component } from '@earendil-works/pi-tui';

const RESET = '\x1b[0m';
const paint = (code: string) => (s: string): string => `\x1b[${code}m${s}${RESET}`;
const green = paint('32');
const red = paint('31');
const dim = paint('2');
const cyanBold = paint('1;36');

export type DiffLineKind = 'add' | 'del' | 'context';

export interface DiffLine {
    kind: DiffLineKind;
    text: string;
}

/** Turn a before/after pair into flat, per-line diff ops for rendering. */
export function computeDiffLines(before: string, after: string): DiffLine[] {
    const parts = diffLines(before ?? '', after ?? '', { newlineIsToken: false });
    const out: DiffLine[] = [];
    for (const part of parts) {
        const lines = part.value.split('\n');
        // diffLines terminates each block with '\n', so the trailing element is ''.
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        const kind: DiffLineKind = part.added ? 'add' : part.removed ? 'del' : 'context';
        for (const text of lines) out.push({ kind, text });
    }
    return out;
}

export type DiffDecision = 'approve' | 'reject' | 'always';

/**
 * A pi-tui component that renders a colored unified diff and resolves an
 * approve / reject / always decision from keyboard input. This is the building
 * block for turning Neo's `confirmCallback` into a real diff-confirm UI.
 */
export class DiffConfirm implements Component {
    onDecision?: (decision: DiffDecision) => void;
    private decided = false;

    constructor(
        private readonly title: string,
        private readonly lines: DiffLine[],
    ) {}

    handleInput(data: string): void {
        if (this.decided) return;
        if (data === 'y' || data === 'Y' || matchesKey(data, Key.enter)) return this.decide('approve');
        if (data === 'n' || data === 'N' || matchesKey(data, Key.escape)) return this.decide('reject');
        if (data === 'a' || data === 'A') return this.decide('always');
    }

    private decide(decision: DiffDecision): void {
        this.decided = true;
        this.onDecision?.(decision);
    }

    invalidate(): void {
        // No cached render state to clear; render() is a pure function of inputs.
    }

    render(width: number): string[] {
        const out: string[] = [];
        let added = 0;
        let removed = 0;

        out.push(truncateToWidth(cyanBold(`● Edit ${this.title}`), width));
        for (const line of this.lines) {
            if (line.kind === 'add') added++;
            else if (line.kind === 'del') removed++;
            const prefix = line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ';
            const color = line.kind === 'add' ? green : line.kind === 'del' ? red : dim;
            out.push(truncateToWidth(color(prefix + line.text), width));
        }
        out.push(truncateToWidth(dim(`+${added} -${removed}   [y] approve   [n] reject   [a] always allow`), width));
        return out;
    }
}
