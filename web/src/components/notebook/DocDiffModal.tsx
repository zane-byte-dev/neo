/**
 * DocDiffModal — AI document editing with section-by-section processing.
 *
 * Flow:
 *   1. Opens immediately; calls LLM to identify logical section boundaries.
 *   2. Polishes all sections in parallel via /api/generate.
 *   3. Shows live progress; user can minimise or cancel at any time.
 *   4. After all sections finish, computes line diff and shows hunk UI.
 *   5. User can Accept / Reject each hunk independently, or bulk Accept/Reject.
 *   6. "Apply Changes" saves to the server and closes.
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCheck, XCircle, Check, Minus, Loader2, AlertCircle, ChevronDown, ChevronUp, Maximize2, Ban } from 'lucide-react'
import {
    diffLines,
    buildHunks,
    applyDecisions,
    diffStats,
    type Hunk,
    type HunkDecision,
    type DiffOp,
} from '../../lib/diff'
import { cn } from '../../lib/utils'
import type { NoteEntry } from '../../types'

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'streaming' | 'diffing' | 'applying' | 'error'

interface Props {
    note: NoteEntry
    actionLabel: string
    /** Full original document content (not truncated). */
    content: string
    /** Per-section transformation instruction sent to /api/generate. */
    instruction: string
    /** Called after user accepts & saves. Receives the final new content. */
    onApply: (noteId: string, newContent: string) => Promise<void>
    onClose: () => void
}

// ── Section splitter (rule-based) ────────────────────────────────────────────

function buildChunks(text: string, maxChars = 6000): string[] {
    const paragraphs = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    if (paragraphs.length === 0) return text.trim() ? [text.trim()] : []

    const chunks: string[] = []
    let current = ''
    for (const paragraph of paragraphs) {
        if (!current) {
            current = paragraph
            continue
        }
        const next = `${current}\n\n${paragraph}`
        if (next.length <= maxChars) {
            current = next
        } else {
            chunks.push(current)
            current = paragraph
        }
    }
    if (current) chunks.push(current)
    return chunks
}

// ── Per-section polish ────────────────────────────────────────────────────────

async function polishSection(
    section: string,
    instruction: string,
    signal: AbortSignal,
): Promise<string> {
    const res = await fetch('/api/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: section, command: 'zap', instruction }),
        signal,
    })
    if (!res.ok) throw new Error(`请求失败 HTTP ${res.status}`)
    return res.text()
}

// ── Component ────────────────────────────────────────────────────────────────

export const DocDiffModal: React.FC<Props> = ({
    note,
    actionLabel,
    content,
    instruction,
    onApply,
    onClose,
}) => {
    const [phase, setPhase] = React.useState<Phase>('streaming')
    const [progress, setProgress] = React.useState<{ current: number; total: number }>({ current: 0, total: 0 })
    const [errorMsg, setErrorMsg] = React.useState('')
    const [ops, setOps] = React.useState<DiffOp[]>([])
    const [hunks, setHunks] = React.useState<Hunk[]>([])
    const [decisions, setDecisions] = React.useState<Map<string, HunkDecision>>(new Map())
    const [collapsedHunks, setCollapsedHunks] = React.useState<Set<string>>(new Set())
    const [minimized, setMinimized] = React.useState(false)
    const abortRef = React.useRef<AbortController | null>(null)

    // ── Section-by-section polish on mount ──────────────────────────────────

    React.useEffect(() => {
        const ac = new AbortController()
        abortRef.current = ac

        async function run() {
            try {
                // Split document into reasonably-sized chunks (rule-based, no LLM call)
                const chunks = buildChunks(content)
                setProgress({ current: 0, total: chunks.length })
                if (ac.signal.aborted) return

                // Polish all chunks in parallel
                let done = 0
                const results = await Promise.all(
                    chunks.map(async (chunk) => {
                        const result = await polishSection(chunk, instruction, ac.signal)
                        done++
                        setProgress(p => ({ ...p, current: done }))
                        return result.trim()
                    })
                )
                if (ac.signal.aborted) return

                const newContent = results.join('\n\n')
                const diffOps = diffLines(content, newContent)
                const diffHunks = buildHunks(diffOps)

                setOps(diffOps)
                setHunks(diffHunks)
                setDecisions(new Map())
                setPhase('diffing')
                setMinimized(false)
            } catch (err: unknown) {
                if (ac.signal.aborted) return
                setErrorMsg(err instanceof Error ? err.message : String(err))
                setPhase('error')
                setMinimized(false)
            }
        }

        void run()
        return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Decision helpers ─────────────────────────────────────────────────────

    const decide = (hunkId: string, d: HunkDecision) =>
        setDecisions(prev => new Map(prev).set(hunkId, d))

    const decideAll = (d: HunkDecision) =>
        setDecisions(new Map(hunks.map(h => [h.id, d])))

    const toggleCollapse = (id: string) =>
        setCollapsedHunks(prev => {
            const next = new Set(prev)
            if (next.has(id)) { next.delete(id) } else { next.add(id) }
            return next
        })

    // ── Apply ────────────────────────────────────────────────────────────────

    const handleApply = async () => {
        setPhase('applying')
        try {
            const finalContent = applyDecisions(ops, hunks, decisions)
            await onApply(note.id, finalContent)
            onClose()
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : '保存失败')
            setPhase('error')
        }
    }

    // ── Derived stats ────────────────────────────────────────────────────────

    const stats = React.useMemo(() => diffStats(ops, hunks), [ops, hunks])
    const acceptedCount = [...decisions.values()].filter(d => d === 'accept').length
    const rejectedCount = [...decisions.values()].filter(d => d === 'reject').length
    const pendingCount = hunks.length - acceptedCount - rejectedCount

    // ── Render ───────────────────────────────────────────────────────────────

    // 最小化状态：显示右下角浮动任务条
    if (minimized) {
        return createPortal(
            <button
                onClick={() => setMinimized(false)}
                className="fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-4 py-3 bg-bg-container border border-border rounded-2xl shadow-2xl hover:shadow-2xl hover:border-primary-mint/60 transition-all group"
                style={{ maxWidth: 320 }}
            >
                <Loader2 size={16} className="animate-spin text-primary-mint shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                    <div className="text-xs font-semibold text-text truncate">{actionLabel}</div>
                    <div className="text-[11px] text-text-tertiary truncate">{note.title}</div>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-text-quaternary shrink-0">
                    <span>
                        {progress.total > 0
                            ? `${progress.current}/${progress.total} 块`
                            : '准备中…'}
                    </span>
                    <Maximize2 size={11} className="ml-1 opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
            </button>,
            document.body,
        )
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.45)' }}
            onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'streaming') onClose() }}
        >
            <div
                className="flex flex-col bg-bg-container border border-border rounded-2xl shadow-2xl overflow-hidden"
                style={{ width: 'min(900px, 92vw)', height: 'min(85vh, 720px)' }}
            >
                {/* ── Header ──────────────────────────────────────────── */}
                <div className="h-12 flex items-center gap-3 px-4 border-b border-border shrink-0 bg-fill-secondary/40">
                    <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-text">{actionLabel}</span>
                        <span className="text-text-tertiary mx-1.5">·</span>
                        <span className="text-sm text-text-secondary truncate">{note.title}</span>
                    </div>
                    {phase === 'diffing' && (
                        <div className="flex items-center gap-1.5 text-xs text-text-tertiary shrink-0">
                            <span className="text-emerald-500 font-medium">+{stats.added}</span>
                            <span className="text-rose-500 font-medium">-{stats.deleted}</span>
                            <span className="mx-1 opacity-40">|</span>
                            <span>{stats.hunks} 处改动</span>
                        </div>
                    )}
                    {/* 流式阶段可最小化到后台 */}
                    {phase === 'streaming' && (
                        <>
                            <button
                                onClick={() => setMinimized(true)}
                                title="后台运行"
                                className="p-1.5 rounded-lg text-text-quaternary hover:text-text hover:bg-fill transition-colors shrink-0"
                            >
                                <Minus size={14} />
                            </button>
                            <button
                                onClick={() => { abortRef.current?.abort(); onClose() }}
                                title="取消"
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                            >
                                <Ban size={12} />
                                取消
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => { abortRef.current?.abort(); onClose() }}
                        className="p-1.5 rounded-lg text-text-quaternary hover:text-text hover:bg-fill transition-colors shrink-0"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* ── Body ────────────────────────────────────────────── */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">

                    {/* Streaming phase */}
                    {phase === 'streaming' && (
                        <StreamingView progress={progress} />
                    )}

                    {/* Diff phase */}
                    {phase === 'diffing' && (
                        <>
                            {hunks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-text-tertiary">
                                    <Check size={32} className="text-emerald-500" />
                                    <p className="text-sm">文章内容与原文完全一致，无需修改。</p>
                                </div>
                            ) : (
                                <div className="p-4 space-y-3">
                                    {hunks.map(hunk => (
                                        <HunkCard
                                            key={hunk.id}
                                            hunk={hunk}
                                            decision={decisions.get(hunk.id) ?? 'pending'}
                                            collapsed={collapsedHunks.has(hunk.id)}
                                            onDecide={(d) => decide(hunk.id, d)}
                                            onToggleCollapse={() => toggleCollapse(hunk.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Applying phase */}
                    {phase === 'applying' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-text-tertiary">
                            <Loader2 size={28} className="animate-spin text-primary-mint" />
                            <p className="text-sm">正在保存…</p>
                        </div>
                    )}

                    {/* Error phase */}
                    {phase === 'error' && (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <AlertCircle size={32} className="text-rose-500" />
                            <p className="text-sm text-text-secondary">{errorMsg || '出现错误，请重试'}</p>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-fill-secondary rounded-lg text-sm hover:bg-fill transition-colors"
                            >
                                关闭
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Footer ──────────────────────────────────────────── */}
                {phase === 'diffing' && hunks.length > 0 && (
                    <div className="h-14 border-t border-border flex items-center gap-2 px-4 shrink-0 bg-fill-secondary/20">
                        {/* Status summary */}
                        <span className="text-xs text-text-tertiary flex-1">
                            {pendingCount > 0
                                ? `${pendingCount} 处待决定`
                                : `已决定 ${acceptedCount} 接受 · ${rejectedCount} 拒绝`}
                        </span>

                        {/* Bulk decisions */}
                        <button
                            onClick={() => decideAll('reject')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
                        >
                            <XCircle size={12} />
                            全部拒绝
                        </button>
                        <button
                            onClick={() => decideAll('accept')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                        >
                            <CheckCheck size={12} />
                            全部接受
                        </button>

                        {/* Apply */}
                        <button
                            onClick={handleApply}
                            disabled={pendingCount === hunks.length && hunks.length > 0}
                            className={cn(
                                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                pendingCount === hunks.length && hunks.length > 0
                                    ? 'bg-fill-secondary text-text-quaternary cursor-not-allowed'
                                    : 'bg-text text-bg hover:opacity-90 active:scale-95',
                            )}
                        >
                            应用更改
                        </button>
                    </div>
                )}
                {phase === 'diffing' && hunks.length === 0 && (
                    <div className="h-14 border-t border-border flex items-center justify-end px-4 shrink-0">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 bg-fill-secondary rounded-lg text-xs hover:bg-fill transition-colors"
                        >
                            关闭
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    )
}

// ── Streaming view ────────────────────────────────────────────────────────────

const StreamingView: React.FC<{ progress: { current: number; total: number } }> = ({ progress }) => (
    <div className="p-6 h-full flex flex-col items-center justify-center gap-4">
        <Loader2 size={28} className="animate-spin text-primary-mint" />
        <div className="text-center">
            <p className="text-sm font-medium text-text">
                {progress.total === 0
                    ? '正在切分文章块…'
                    : `并行优化中（${progress.current} / ${progress.total} 块完成）`}
            </p>
            <p className="text-xs text-text-tertiary mt-1">完成后将自动显示差异对比</p>
        </div>
        {progress.total > 0 && (
            <div className="w-48 h-1.5 bg-fill-secondary rounded-full overflow-hidden">
                <div
                    className="h-full bg-primary-mint rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
            </div>
        )}
    </div>
)

// ── Hunk card ─────────────────────────────────────────────────────────────────

const HunkCard: React.FC<{
    hunk: Hunk
    decision: HunkDecision
    collapsed: boolean
    onDecide: (d: HunkDecision) => void
    onToggleCollapse: () => void
}> = ({ hunk, decision, collapsed, onDecide, onToggleCollapse }) => {
    const borderColor =
        decision === 'accept' ? 'border-emerald-400/60 dark:border-emerald-600/50' :
        decision === 'reject' ? 'border-rose-400/60 dark:border-rose-600/50' :
        'border-border'

    const headerBg =
        decision === 'accept' ? 'bg-emerald-500/8' :
        decision === 'reject' ? 'bg-rose-500/8' :
        'bg-fill-secondary/50'

    const changedLineCount = hunk.lines.filter(l => l.type !== 'same').length

    return (
        <div className={cn('rounded-xl border overflow-hidden transition-colors', borderColor)}>
            {/* Hunk header */}
            <div className={cn('flex items-center gap-2 px-3 py-2 cursor-pointer select-none', headerBg)}
                onClick={onToggleCollapse}
            >
                <button
                    className="text-text-quaternary hover:text-text-tertiary transition-colors"
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
                >
                    {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
                <span className="text-[11px] text-text-tertiary flex-1">
                    {changedLineCount} 行变更
                    {decision === 'accept' && <span className="text-emerald-500 ml-2">· 已接受</span>}
                    {decision === 'reject' && <span className="text-rose-500 ml-2">· 已拒绝</span>}
                </span>
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button
                        onClick={() => onDecide(decision === 'reject' ? 'pending' : 'reject')}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all',
                            decision === 'reject'
                                ? 'bg-rose-500 text-white'
                                : 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/15',
                        )}
                    >
                        <Minus size={10} />
                        拒绝
                    </button>
                    <button
                        onClick={() => onDecide(decision === 'accept' ? 'pending' : 'accept')}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all',
                            decision === 'accept'
                                ? 'bg-emerald-500 text-white'
                                : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15',
                        )}
                    >
                        <Check size={10} />
                        接受
                    </button>
                </div>
            </div>

            {/* Diff lines */}
            {!collapsed && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs font-mono border-collapse">
                        <tbody>
                            {hunk.lines.map((line, idx) => (
                                <DiffLineRow key={idx} line={line} decision={decision} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

// ── Single diff line ──────────────────────────────────────────────────────────

const DiffLineRow: React.FC<{
    line: { type: 'same' | 'add' | 'del'; content: string }
    decision: HunkDecision
}> = ({ line, decision }) => {
    // When accepted: del lines are dimmed/hidden, add lines are highlighted green
    // When rejected: add lines are dimmed/hidden, del lines are highlighted red
    // When pending: show both sides as-is

    const isAdd = line.type === 'add'
    const isDel = line.type === 'del'
    const isSame = line.type === 'same'

    const hidden =
        (isAdd && decision === 'reject') ||
        (isDel && decision === 'accept')

    if (hidden) return null

    let rowBg = ''
    let gutter = ' '
    let gutterColor = 'text-text-quaternary'
    let lineColor = 'text-text-secondary'

    if (isAdd) {
        rowBg = 'bg-emerald-500/10 dark:bg-emerald-500/8'
        gutter = '+'
        gutterColor = 'text-emerald-600 dark:text-emerald-400 font-bold'
        lineColor = 'text-emerald-800 dark:text-emerald-200'
    } else if (isDel) {
        rowBg = 'bg-rose-500/10 dark:bg-rose-500/8'
        gutter = '−'
        gutterColor = 'text-rose-600 dark:text-rose-400 font-bold'
        lineColor = 'text-rose-800 dark:text-rose-200 line-through opacity-70'
    }
    const dimmed = isSame ? 'opacity-60' : ''

    return (
        <tr className={cn(rowBg, dimmed)}>
            <td className={cn('w-6 px-2 py-0.5 text-center select-none shrink-0', gutterColor)}>
                {gutter}
            </td>
            <td className={cn('px-3 py-0.5 whitespace-pre-wrap break-all', lineColor)}>
                {line.content || <span className="opacity-30">&nbsp;</span>}
            </td>
        </tr>
    )
}
