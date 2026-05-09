import React from 'react'
import { X, Trash2, RotateCcw, FileText, MessageSquare, BookOpen, Loader2, AlertTriangle } from 'lucide-react'
import { fetchTrash, restoreTrashItem, permanentDeleteTrashItem, emptyTrash, type TrashItem } from '../api'
import { useT } from '../i18n'
import { toast } from './Toast'
import { cn } from '../lib/utils'

interface TrashPanelProps {
    onClose: () => void
    /** Called when items are restored so callers can refresh their lists */
    onRestored?: (item: TrashItem) => void
}

function typeIcon(type: TrashItem['type']) {
    if (type === 'session') return <MessageSquare size={14} className="shrink-0 text-text-tertiary" />
    if (type === 'notebook') return <BookOpen size={14} className="shrink-0 text-text-tertiary" />
    return <FileText size={14} className="shrink-0 text-text-tertiary" />
}

function formatRelativeTime(ms: number): string {
    const diff = Date.now() - ms
    const days = Math.floor(diff / 86_400_000)
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 30) return `${days} 天前`
    return new Date(ms).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export const TrashPanel: React.FC<TrashPanelProps> = ({ onClose, onRestored }) => {
    const t = useT()
    const [items, setItems] = React.useState<TrashItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [actionId, setActionId] = React.useState<string | null>(null)
    const [confirmEmpty, setConfirmEmpty] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState('')

    React.useEffect(() => {
        setLoading(true)
        fetchTrash()
            .then((data) => setItems(data.items))
            .catch(() => setItems([]))
            .finally(() => setLoading(false))
    }, [])

    const handleRestore = async (item: TrashItem) => {
        setActionId(item.id)
        try {
            await restoreTrashItem(item.id)
            setItems((prev) => prev.filter((i) => i.id !== item.id))
            toast.success(t('trashRestoreSuccess'))
            onRestored?.(item)
        } catch {
            toast.error(t('trashRestoreFailed'))
        } finally {
            setActionId(null)
        }
    }

    const handlePermanentDelete = async (item: TrashItem) => {
        setActionId(item.id)
        try {
            await permanentDeleteTrashItem(item.id)
            setItems((prev) => prev.filter((i) => i.id !== item.id))
            toast.success(t('trashDeleteSuccess'))
        } catch {
            toast.error(t('trashDeleteFailed'))
        } finally {
            setActionId(null)
        }
    }

    const handleEmptyAll = async () => {
        setConfirmEmpty(false)
        try {
            await emptyTrash()
            setItems([])
            toast.success(t('trashEmptied'))
        } catch {
            toast.error(t('trashEmptyFailed'))
        }
    }

    const filtered = searchQuery.trim()
        ? items.filter((i) => i.title.toLowerCase().includes(searchQuery.toLowerCase()))
        : items

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

            {/* Panel */}
            <div
                className="fixed left-[260px] top-[60px] z-50 w-[380px] max-h-[520px] flex flex-col glass border border-border rounded-2xl shadow-float animate-slide-up overflow-hidden"
                style={{ boxShadow: 'var(--shadow-float)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-border/50 shrink-0">
                    <Trash2 size={15} className="text-text-secondary" />
                    <span className="text-sm font-semibold text-text flex-1">{t('trash')}</span>
                    {items.length > 0 && !loading && (
                        <button
                            onClick={() => setConfirmEmpty(true)}
                            className="text-[11px] text-destructive hover:text-destructive/80 transition-colors cursor-pointer px-1.5 py-0.5 rounded"
                        >
                            {t('trashEmptyAll')}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-fill-secondary transition-colors text-text-tertiary hover:text-text cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-3 py-2 border-b border-border/50 shrink-0">
                    <input
                        type="text"
                        placeholder="搜索已删除的页面"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full text-xs bg-fill-secondary/60 border border-border/40 rounded-lg px-3 py-1.5 outline-none placeholder:text-text-quaternary text-text focus:border-primary/50 transition-colors"
                    />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={18} className="animate-spin text-text-tertiary" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
                            <Trash2 size={28} className="text-text-quaternary" strokeWidth={1.5} />
                            <p className="text-sm font-medium text-text-secondary">
                                {searchQuery ? '无结果' : t('trashEmpty')}
                            </p>
                            {!searchQuery && (
                                <p className="text-xs text-text-tertiary leading-relaxed">
                                    {t('trashEmptyHint')}
                                </p>
                            )}
                        </div>
                    ) : (
                        <ul className="py-1">
                            {filtered.map((item) => {
                                const busy = actionId === item.id
                                return (
                                    <li
                                        key={item.id}
                                        className={cn(
                                            'group flex items-start gap-2.5 px-4 py-2.5 hover:bg-fill-secondary/50 transition-colors',
                                            busy && 'opacity-50 pointer-events-none',
                                        )}
                                    >
                                        {typeIcon(item.type)}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-text truncate leading-snug">{item.title}</p>
                                            <p className="text-[10px] text-text-tertiary mt-0.5">
                                                {item.notebook
                                                    ? `${item.notebook} · `
                                                    : item.type === 'session'
                                                    ? `${t('trashTypeSession')} · `
                                                    : item.type === 'notebook'
                                                    ? `${t('trashTypeNotebook')} · `
                                                    : `${t('trashTypeArticle')} · `}
                                                {formatRelativeTime(item.deletedAt)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                onClick={() => handleRestore(item)}
                                                title={t('trashRestore')}
                                                className="p-1.5 rounded-lg hover:bg-fill-secondary text-text-tertiary hover:text-primary transition-colors cursor-pointer"
                                            >
                                                {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                            </button>
                                            <button
                                                onClick={() => handlePermanentDelete(item)}
                                                title={t('trashDeletePermanently')}
                                                className="p-1.5 rounded-lg hover:bg-destructive/10 text-text-tertiary hover:text-destructive transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer note */}
                <div className="px-4 py-2.5 border-t border-border/50 shrink-0">
                    <p className="text-[10px] text-text-quaternary">{t('trashAutoDelete')}</p>
                </div>
            </div>

            {/* Empty trash confirmation dialog */}
            {confirmEmpty && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
                    onClick={() => setConfirmEmpty(false)}
                >
                    <div
                        className="glass border border-border rounded-2xl p-5 w-[320px] animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold mb-1">{t('trashEmptyAll')}</h3>
                                <p className="text-xs text-text-secondary leading-relaxed">{t('trashEmptyConfirm')}</p>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmEmpty(false)}
                                className="px-3.5 py-1.5 text-xs rounded-lg border border-border hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={handleEmptyAll}
                                className="px-3.5 py-1.5 text-xs rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors cursor-pointer"
                            >
                                {t('trashEmptyAll')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
