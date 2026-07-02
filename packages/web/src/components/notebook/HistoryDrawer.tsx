/**
 * HistoryDrawer — Notion 风格版本历史弹窗
 * 左侧：文章内容预览（随版本切换）
 * 右侧：版本列表 + 底部恢复按钮
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { notebookHistory, notebookHistoryContent, notebookUpdate, type ArticleCommit } from '../../api'
import type { NoteEntry } from '../../types'

interface Props {
    note: NoteEntry
    currentContent: string
    onClose: () => void
    onRestored: (entry: NoteEntry) => void
}

/** "今天 · 17:38" / "5月7日 · 15:21" / "2025年4月22日 · 11:55" */
function formatVersionTime(isoDate: string): string {
    try {
        const d = new Date(isoDate)
        const now = new Date()
        const isToday =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate()
        const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
        if (isToday) return `今天 · ${hm}`
        const isThisYear = d.getFullYear() === now.getFullYear()
        const md = isThisYear
            ? `${d.getMonth() + 1}月${d.getDate()}日`
            : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
        return `${md} · ${hm}`
    } catch {
        return isoDate
    }
}

export const HistoryDrawer: React.FC<Props> = ({ note, currentContent, onClose, onRestored }) => {
    const [commits, setCommits] = React.useState<ArticleCommit[]>([])
    const [loadingList, setLoadingList] = React.useState(true)
    const [listError, setListError] = React.useState(false)

    // idx 0 = 最新版（当前），自动选中
    const [selectedIdx, setSelectedIdx] = React.useState(0)
    const [previewContent, setPreviewContent] = React.useState<string | null>(currentContent)
    const [previewTitle, setPreviewTitle] = React.useState(note.title)
    const [loadingPreview, setLoadingPreview] = React.useState(false)

    const [restoring, setRestoring] = React.useState(false)
    const [restoreError, setRestoreError] = React.useState(false)

    // Load commit list on mount
    React.useEffect(() => {
        setLoadingList(true)
        setListError(false)
        notebookHistory(note.id)
            .then((data) => setCommits(data))
            .catch(() => setListError(true))
            .finally(() => setLoadingList(false))
    }, [note.id])

    // Load preview when selection changes (idx 0 = current, no fetch needed)
    React.useEffect(() => {
        if (commits.length === 0) return
        if (selectedIdx === 0) {
            setPreviewContent(currentContent)
            setPreviewTitle(note.title)
            return
        }
        const c = commits[selectedIdx]
        if (!c) return
        setLoadingPreview(true)
        notebookHistoryContent(note.id, c.hash)
            .then((data) => {
                setPreviewContent(data.content)
                setPreviewTitle(data.title || note.title)
            })
            .catch(() => setPreviewContent(null))
            .finally(() => setLoadingPreview(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIdx, commits])

    const handleRestore = async () => {
        if (selectedIdx === 0 || previewContent === null) return
        setRestoring(true)
        setRestoreError(false)
        try {
            const updated = await notebookUpdate(note.id, { content: previewContent })
            onRestored(updated)
            onClose()
        } catch {
            setRestoreError(true)
        } finally {
            setRestoring(false)
        }
    }

    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    const isCurrent = selectedIdx === 0
    const canRestore = !isCurrent && previewContent !== null && !loadingPreview

    const modal = (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

            {/* Modal */}
            <div className="relative flex w-full max-w-5xl h-[90vh] bg-white dark:bg-[#191919] rounded-xl shadow-2xl overflow-hidden animate-slide-up border border-border">

                {/* ── Left: content preview ─────────────────────────────── */}
                <div className="flex-1 min-w-0 overflow-y-auto">
                    {loadingPreview && (
                        <div className="flex items-center justify-center h-full text-text-quaternary">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    )}
                    {!loadingPreview && previewContent === null && (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-text-quaternary">
                            <AlertCircle size={18} />
                            <span className="text-sm">无法加载此版本</span>
                        </div>
                    )}
                    {!loadingPreview && previewContent !== null && (
                        <div className="w-full max-w-[46rem] mx-auto px-16 pt-14 pb-20">
                            <h1 className="text-[2rem] font-bold leading-[1.3] mb-6 text-[#1a1a1a] dark:text-[#e8e8e8]">
                                {previewTitle || <span className="text-text-quaternary italic font-normal">无标题</span>}
                            </h1>
                            <div className="text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap break-words">
                                {previewContent || <span className="text-text-quaternary italic">（空内容）</span>}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Right: version list sidebar ───────────────────────── */}
                <div className="w-[220px] shrink-0 border-l border-border flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
                        <span className="text-[13px] font-semibold text-text-primary">版本历史</span>
                        <button
                            onClick={onClose}
                            className="w-6 h-6 flex items-center justify-center rounded-md text-text-quaternary hover:text-text-secondary hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto">
                        {loadingList && (
                            <div className="flex items-center justify-center py-10 text-text-quaternary">
                                <Loader2 size={15} className="animate-spin" />
                            </div>
                        )}
                        {listError && !loadingList && (
                            <div className="flex flex-col items-center gap-2 py-10 text-text-quaternary px-4 text-center">
                                <AlertCircle size={14} />
                                <span className="text-[11px]">无法加载历史记录</span>
                            </div>
                        )}
                        {!loadingList && !listError && commits.length === 0 && (
                            <div className="flex flex-col items-center gap-1.5 py-10 text-text-quaternary px-4 text-center">
                                <span className="text-[12px]">暂无版本记录</span>
                                <span className="text-[11px] opacity-60">保存后自动生成版本</span>
                            </div>
                        )}
                        {commits.map((c, idx) => {
                            const selected = idx === selectedIdx
                            return (
                                <button
                                    key={c.hash}
                                    onClick={() => setSelectedIdx(idx)}
                                    className={cn(
                                        'w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors border-b border-border/30 last:border-0',
                                        selected
                                            ? 'bg-gray-100 dark:bg-white/8'
                                            : 'hover:bg-gray-50 dark:hover:bg-white/5',
                                    )}
                                >
                                    <span className={cn(
                                        'text-[12px] font-medium leading-snug',
                                        selected ? 'text-text-primary' : 'text-text-secondary',
                                    )}>
                                        {formatVersionTime(c.date)}
                                    </span>
                                    <span className="text-[11px] text-text-quaternary truncate">
                                        {c.author || '未知'}
                                    </span>
                                </button>
                            )
                        })}
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-2">
                        {restoreError
                            ? <span className="text-[11px] text-rose-500 flex items-center gap-1 flex-1"><AlertCircle size={10} /> 恢复失败</span>
                            : <span className="flex-1" />
                        }
                        <button
                            onClick={handleRestore}
                            disabled={!canRestore || restoring}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md font-medium transition-colors',
                                canRestore && !restoring
                                    ? 'bg-[#2ecc71] hover:bg-[#27ae60] text-white'
                                    : 'bg-gray-100 dark:bg-white/8 text-text-quaternary cursor-not-allowed',
                            )}
                        >
                            {restoring && <Loader2 size={11} className="animate-spin" />}
                            恢复
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )

    return createPortal(modal, document.body)
}
