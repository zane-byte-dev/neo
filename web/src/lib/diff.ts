/**
 * diff.ts — Line-level text diff using Myers algorithm (same as git).
 *
 * Backed by the battle-tested `diff` npm package instead of a hand-rolled LCS,
 * which produced noisy results for long documents with many blank lines.
 */

import { diffLines as _diffLines } from 'diff'

export type DiffOpType = 'same' | 'add' | 'del'

export interface DiffOp {
    type: DiffOpType
    value: string
}

export interface HunkLine {
    type: DiffOpType
    content: string
}

export interface Hunk {
    id: string
    lines: HunkLine[]
    /** Start index (inclusive) into the ops array used to build this hunk. */
    opStart: number
    /** End index (exclusive) into the ops array. */
    opEnd: number
}

export type HunkDecision = 'accept' | 'reject' | 'pending'

const CONTEXT = 3

// ── Core diff ────────────────────────────────────────────────────────────────

/** Compute a line-level diff between two texts using Myers algorithm (same as git). */
export function diffLines(oldText: string, newText: string): DiffOp[] {
    const changes = _diffLines(oldText ?? '', newText ?? '', { newlineIsToken: false })
    const ops: DiffOp[] = []
    for (const change of changes) {
        // Each change.value may contain multiple lines; split and emit per-line ops
        // but preserve the trailing newline structure by trimming a final empty entry
        const lines = change.value.split('\n')
        // _diffLines always ends each block with '\n' so the last element is ''
        if (lines[lines.length - 1] === '') lines.pop()
        const type: DiffOpType = change.added ? 'add' : change.removed ? 'del' : 'same'
        for (const line of lines) {
            ops.push({ type, value: line })
        }
    }
    return ops
}

// ── Hunk grouping ────────────────────────────────────────────────────────────

/** Group diff ops into hunks (changed regions + surrounding context lines). */
export function buildHunks(ops: DiffOp[]): Hunk[] {
    // Mark which op indices should appear in a hunk
    const inHunk = new Uint8Array(ops.length)
    for (let i = 0; i < ops.length; i++) {
        if (ops[i].type !== 'same') {
            const lo = Math.max(0, i - CONTEXT)
            const hi = Math.min(ops.length - 1, i + CONTEXT)
            for (let k = lo; k <= hi; k++) inHunk[k] = 1
        }
    }

    // Collect contiguous marked spans that contain at least one change
    const hunks: Hunk[] = []
    let start = -1
    for (let i = 0; i <= ops.length; i++) {
        if (i < ops.length && inHunk[i]) {
            if (start < 0) start = i
        } else if (start >= 0) {
            const slice = ops.slice(start, i)
            if (slice.some(o => o.type !== 'same')) {
                hunks.push({
                    id: String(hunks.length),
                    lines: slice.map(o => ({ type: o.type, content: o.value })),
                    opStart: start,
                    opEnd: i,
                })
            }
            start = -1
        }
    }
    return hunks
}

// ── Decision application ─────────────────────────────────────────────────────

/**
 * Apply per-hunk accept/reject decisions to produce the final text.
 *
 * Rules:
 *  - 'same' ops    → always included
 *  - 'add'  ops in a hunk → included if hunk is accepted or pending
 *  - 'del'  ops in a hunk → included if hunk is rejected or pending
 *  - ops outside all hunks → always 'same', always included
 */
export function applyDecisions(
    ops: DiffOp[],
    hunks: Hunk[],
    decisions: Map<string, HunkDecision>,
): string {
    // Build reverse index: op index → hunk id
    const opHunk = new Map<number, string>()
    for (const h of hunks) {
        for (let i = h.opStart; i < h.opEnd; i++) opHunk.set(i, h.id)
    }

    const lines: string[] = []
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        const hunkId = opHunk.get(i)
        if (op.type === 'same') {
            lines.push(op.value)
        } else if (hunkId !== undefined) {
            const d: HunkDecision = decisions.get(hunkId) ?? 'pending'
            if (op.type === 'add' && (d === 'accept' || d === 'pending')) lines.push(op.value)
            if (op.type === 'del' && (d === 'reject' || d === 'pending')) lines.push(op.value)
        }
    }
    return lines.join('\n')
}

// ── Stats helpers ────────────────────────────────────────────────────────────

export interface DiffStats {
    hunks: number
    added: number
    deleted: number
}

export function diffStats(ops: DiffOp[], hunks: Hunk[]): DiffStats {
    let added = 0, deleted = 0
    for (const op of ops) {
        if (op.type === 'add') added++
        else if (op.type === 'del') deleted++
    }
    return { hunks: hunks.length, added, deleted }
}

// ── AI output post-processing ────────────────────────────────────────────────

/**
 * Strip common AI wrapper patterns from a doc-edit response,
 * returning clean document content only.
 */
export function extractDocContent(raw: string): string {
    let text = raw.trim()

    // Remove fenced code blocks (```markdown ... ``` or just ``` ... ```)
    const fenced = text.match(/^```(?:markdown|md|text|plaintext)?\n?([\s\S]*?)\n?```\s*$/i)
    if (fenced) return fenced[1].trim()

    // Strip common Chinese AI preambles (one line at a time from the top)
    const preamble = /^(以下是|下面是|这是|优化后的|格式化后的|翻译后的|改写后的)[^\n]*[:：]\s*/
    text = text.replace(preamble, '')

    return text.trim()
}
