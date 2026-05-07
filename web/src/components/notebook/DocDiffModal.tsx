/**
 * DocDiffModal — AI document editing with line-level diff review.
 *
 * Flow:
 *   1. Opens immediately and starts streaming AI response.
 *   2. Shows live streaming text while generating.
 *   3. After stream finishes, computes line diff and shows hunk UI.
 *   4. User can Accept / Reject each hunk independently, or use
 *      "Accept All" / "Reject All" for bulk decisions.
 *   5. "Apply Changes" saves to the server and closes.
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCheck, XCircle, Check, Minus, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { streamChat } from '../../api'
import {
    diffLines,
    buildHunks,
    applyDecisions,
    diffStats,
    extractDocContent,
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
    /** Full prompt including document content and instruction. */
    prompt: string
    /** Called after user accepts & saves. Receives the final new content. */
    onApply: (noteId: string, newContent: string) => Promise<void>
    onClose: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export const DocDiffModal: React.FC<Props> = ({
    note,
    actionLabel,
    prompt,
    onApply,
    onClose,
}) => {
    const [phase, setPhase] = React.useState<Phase>('streaming')
    const [streamText, setStreamText] = React.useState('')
    const [errorMsg, setErrorMsg] = React.useState('')
    const [ops, setOps] = React.useState<DiffOp[]>([])
    const [hunks, setHunks] = React.useState<Hunk[]>([])
    const [decisions, setDecisions] = React.useState<Map<string, HunkDecision>>(new Map())
    const [collapsedHunks, setCollapsedHunks] = React.useState<Set<string>>(new Set())
    const abortRef = React.useRef<AbortController | null>(null)

    // ── Stream AI response on mount ──────────────────────────────────────────

    React.useEffect(() => {
        const ac = new AbortController()
        abortRef.current = ac

        let accumulated = ''

        async function run() {
            try {
                // Use an ephemeral session — never registered in the client store,
                // so it won't appear in the chat sidebar.
                const sessionId = `_doc-edit-${crypto.randomUUID()}`
                for await (const chunk of streamChat(prompt, sessionId, ac.signal)) {
                    if (ac.signal.aborted) return
                    if (chunk.type === 'text' && chunk.text) {
                        accumulated += chunk.text
                        setStreamText(accumulated)
                    }
                    if (chunk.type === 'done') break
                    if (chunk.type === 'error') throw new Error(chunk.text ?? 'AI 响应出错')
                }

                // Post-process and compute diff
                const newContent = extractDocContent(accumulated)
                const originalContent = note.content ?? ''
                const diffOps = diffLines(originalContent, newContent)
                const diffHunks = buildHunks(diffOps)

                setOps(diffOps)
                setHunks(diffHunks)
                setDecisions(new Map())
                setPhase('diffing')
            } catch (err: unknown) {
                if (ac.signal.aborted) return
                setErrorMsg(err instanceof Error ? err.message : String(err))
                setPhase('error')
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
            next.has(id) ? next.delete(id) : next.add(id)
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

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.45)' }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
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
                        <StreamingView text={streamText} />
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

const StreamingView: React.FC<{ text: string }> = ({ text }) => (
    <div className="p-4 h-full flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin text-primary-mint shrink-0" />
            <span>AI 正在生成内容，完成后将显示差异对比…</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-fill-secondary/50 border border-border/60 p-3">
            <pre className="text-xs text-text-secondary font-mono leading-relaxed whitespace-pre-wrap break-words">
                {text || <span className="opacity-40">等待响应…</span>}
            </pre>
        </div>
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
