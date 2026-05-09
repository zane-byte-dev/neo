import React from 'react'
import { Settings, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { notebookRenameFolder } from '../../api'

type NoteSort = 'default' | 'date-desc' | 'date-asc' | 'title'

const SORT_LABELS: Record<NoteSort, string> = {
    default: '默认', 'date-desc': '最新', 'date-asc': '最早', title: '标题',
}

export function getNotebookSort(notebook: string): NoteSort {
    try { return (localStorage.getItem(`neo:sort:${notebook}`) as NoteSort) || 'default' } catch { return 'default' }
}

export function setNotebookSort(notebook: string, sort: NoteSort): void {
    try { localStorage.setItem(`neo:sort:${notebook}`, sort) } catch { /* ignore */ }
}

export function applySortToEntries<T extends { date?: string | null; title: string }>(entries: T[], sort: NoteSort): T[] {
    const arr = [...entries]
    if (sort === 'date-desc') arr.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    else if (sort === 'date-asc') arr.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    else if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    return arr
}

export const NotebookSettingsModal: React.FC<{
    notebook: string
    onClose: () => void
    onRenamed: (newName: string) => void
    onSortChange?: (s: NoteSort) => void
}> = ({ notebook, onClose, onRenamed, onSortChange }) => {
    const [name, setName] = React.useState(notebook)
    const [sortBy, setSortBy] = React.useState<NoteSort>(() => getNotebookSort(notebook))
    const [saving, setSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const overlayRef = React.useRef<HTMLDivElement>(null)

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === overlayRef.current) onClose()
    }

    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [onClose])

    const handleSortChange = (s: NoteSort) => {
        setSortBy(s)
        setNotebookSort(notebook, s)
        onSortChange?.(s)
    }

    const handleSave = async () => {
        const trimmed = name.trim()
        if (!trimmed) { setError('名称不能为空'); return }
        setSaving(true)
        setError('')
        try {
            if (trimmed !== notebook) {
                await notebookRenameFolder(notebook, trimmed)
                onRenamed(trimmed)
            } else {
                onClose()
            }
        } catch (e) {
            setError((e as Error).message ?? '保存失败')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={handleOverlayClick}
        >
            <div className="bg-bg-container border border-border rounded-2xl shadow-2xl w-80 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <Settings size={14} className="text-text-tertiary" />
                    <span className="text-sm font-semibold flex-1">笔记本设置</span>
                    <button onClick={onClose} className="p-1 rounded-md hover:bg-fill text-text-quaternary hover:text-text transition-colors">
                        <X size={14} />
                    </button>
                </div>
                {/* Body */}
                <div className="px-4 py-4 space-y-4">
                    {/* Name */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary">文件夹名称</label>
                        <input
                            autoFocus
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                            className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-mint/40 placeholder:text-text-quaternary transition-all"
                            placeholder="笔记本名称"
                        />
                        {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                    {/* Sort */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-secondary">文章排序</label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {(Object.entries(SORT_LABELS) as [NoteSort, string][]).map(([k, v]) => (
                                <button
                                    key={k}
                                    onClick={() => handleSortChange(k)}
                                    className={cn(
                                        'px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left',
                                        sortBy === k
                                            ? 'bg-primary-mint/12 text-primary-mint font-medium'
                                            : 'bg-fill-secondary text-text-secondary hover:bg-fill hover:text-text'
                                    )}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                {/* Footer */}
                <div className="flex gap-2 px-4 py-3 border-t border-border">
                    <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg text-xs bg-fill-secondary text-text-secondary hover:bg-fill transition-colors">
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-3 py-2 rounded-lg text-xs bg-primary-mint text-white hover:bg-primary-mint/90 transition-colors disabled:opacity-50"
                    >
                        {saving ? '保存中…' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    )
}
