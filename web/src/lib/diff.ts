/**
 * diff.ts — Line-level text diff (pure TypeScript, zero external dependencies).
 *
 * Algorithm: Iterative LCS backtracking — O(m·n) time & space.
 * Suitable for documents up to ~1000 lines; our 4000-char truncated
 * input is typically 100–300 lines, so this is comfortably fast.
 */

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

/** Compute a line-level diff between two texts. */
export function diffLines(oldText: string, newText: string): DiffOp[] {
    const a = oldText ? oldText.split('\n') : []
    const b = newText ? newText.split('\n') : []
    const m = a.length
    const n = b.length

    if (m === 0) return b.map(v => ({ type: 'add' as const, value: v }))
    if (n === 0) return a.map(v => ({ type: 'del' as const, value: v }))

    // LCS DP table (Uint32Array for memory efficiency)
    const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1])
        }
    }

    // Iterative backtrack
    const ops: DiffOp[] = []
    let i = m, j = n
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            ops.push({ type: 'same', value: a[i - 1] }); i--; j--
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            ops.push({ type: 'add', value: b[j - 1] }); j--
        } else {
            ops.push({ type: 'del', value: a[i - 1] }); i--
        }
    }
    return ops.reverse()
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
