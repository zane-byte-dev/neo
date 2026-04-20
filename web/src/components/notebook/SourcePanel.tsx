/**
 * SourcePanel — left column of notebook workspace.
 * Lists sources with checkbox selection, context menu (rename/archive),
 * and prominent "添加来源" button opening AddSourceModal.
 */
import React from 'react'
import { FileText, Link as LinkIcon, Type, Plus, Trash2, Loader2, Youtube, Check, MoreVertical, Pencil, Archive, ArrowUpDown } from 'lucide-react'
import type { SourceMeta } from '../../types'
import { useAppStore } from '../../stores/useAppStore'
import {
    notebookListSources,
    notebookGetSourceGuide,
    notebookGenerateSourceGuide,
    notebookArchiveSource,
    notebookRenameSource,
} from '../../api'
import { AddSourceModal } from './AddSourceModal'
import { SourceRow } from './SourceRow'
import { toast } from '../Toast'
import { confirm } from '../ConfirmDialog'

interface Props {
    notebook: string
    onSelectSource?: (source: SourceMeta) => void
}

type SortOption = 'default' | 'type' | 'title' | 'words-desc' | 'words-asc' | 'has-guide'

const SORT_LABELS: Record<SortOption, string> = {
    default: '默认',
    type: '类型',
    title: '标题',
    'words-desc': '字数↓',
    'words-asc': '字数↑',
    'has-guide': '有摘要优先',
}

export const SourcePanel: React.FC<Props> = ({ notebook, onSelectSource }) => {
    const { sources, setSources, selectedSourceIds, setSelectedSourceIds, toggleSourceSelected, setSourceGuide, sourceGuides } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [modalOpen, setModalOpen] = React.useState(false)
    const [batchGenerating, setBatchGenerating] = React.useState(false)
    const [sortBy, setSortBy] = React.useState<SortOption>('default')
    const batchAbort = React.useRef(false)

    const load = React.useCallback(async () => {
        setLoading(true)
        try {
            const data = await notebookListSources(notebook)
            setSources(data)
            // Select all by default
            setSelectedSourceIds(data.map((s) => s.id))
            // Prefetch guides (store null for sources with no guide yet)
            data.forEach((s) => {
                notebookGetSourceGuide(notebook, s.id)
                    .then((g) => setSourceGuide(s.id, g ?? null))
                    .catch(() => setSourceGuide(s.id, null))
            })
        } catch (e) {
            console.warn('[SourcePanel] load failed', e)
        } finally {
            setLoading(false)
        }
    }, [notebook, setSources, setSelectedSourceIds, setSourceGuide])

    React.useEffect(() => { load() }, [load])

    const toggleAll = () => {
        if (selectedSourceIds.length === sources.length) setSelectedSourceIds([])
        else setSelectedSourceIds(sources.map((s) => s.id))
    }

    // Count sources without guides (null = checked but no guide)
    const missingGuideCount = sources.filter((s) => sourceGuides[s.id] === null).length

    const handleBatchGenerate = async () => {
        batchAbort.current = false
        setBatchGenerating(true)
        const missing = sources.filter((s) => sourceGuides[s.id] === null)
        for (const s of missing) {
            if (batchAbort.current) break
            try {
                const guide = await notebookGenerateSourceGuide(notebook, s.id)
                setSourceGuide(s.id, guide)
            } catch { /* skip failed */ }
        }
        setBatchGenerating(false)
    }

    const handleStopBatch = () => { batchAbort.current = true }

    const handleBatchArchive = async () => {
        if (selectedSourceIds.length === 0) { toast.warning('请先选择来源'); return }
        if (!(await confirm(`批量移除 ${selectedSourceIds.length} 个来源？`, {
            description: '文件不会被删除，仅从列表中隐藏',
            destructive: true,
            confirmText: '批量移除',
        }))) return
        let archived = 0
        for (const id of selectedSourceIds) {
            try {
                await notebookArchiveSource(notebook, id)
                archived++
            } catch { /* skip */ }
        }
        if (archived > 0) {
            setSources(sources.filter((s) => !selectedSourceIds.includes(s.id)))
            setSelectedSourceIds([])
            toast.success(`已移除 ${archived} 个来源`)
        }
    }

    // Sort sources
    const sortedSources = React.useMemo(() => {
        const sorted = [...sources]
        switch (sortBy) {
            case 'type':
                sorted.sort((a, b) => a.type.localeCompare(b.type))
                break
            case 'title':
                sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
                break
            case 'words-desc':
                sorted.sort((a, b) => (b.wordCount ?? 0) - (a.wordCount ?? 0))
                break
            case 'words-asc':
                sorted.sort((a, b) => (a.wordCount ?? 0) - (b.wordCount ?? 0))
                break
            case 'has-guide':
                sorted.sort((a, b) => {
                    const aHas = sourceGuides[a.id] ? 1 : 0
                    const bHas = sourceGuides[b.id] ? 1 : 0
                    return bHas - aHas
                })
                break
            default: // 'default' — keep original order
                break
        }
        return sorted
    }, [sources, sortBy, sourceGuides])

    return (
        <div className="flex flex-col h-full bg-bg-container border-r border-border">
            <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <FileText size={15} className="text-primary-mint" />
                <span className="text-sm font-semibold flex-1">来源 ({sources.length})</span>
                <button
                    onClick={() => setModalOpen(true)}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary hover:text-primary-mint transition-colors"
                    title="添加来源"
                >
                    <Plus size={15} />
                </button>
            </div>

            {/* Prominent add button */}
            <div className="px-3 pt-3 pb-2 shrink-0">
                <button
                    onClick={() => setModalOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-border hover:border-primary-mint/50 rounded-xl text-sm text-text-secondary hover:text-primary-mint transition-colors"
                >
                    <Plus size={15} /> 添加来源
                </button>
            </div>

            {sources.length > 0 && (
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                        onClick={toggleAll}
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
                    >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedSourceIds.length === sources.length ? 'bg-primary-mint border-primary-mint' : 'border-border'}`}>
                            {selectedSourceIds.length === sources.length && <Check size={10} className="text-white" />}
                        </span>
                        全选
                    </button>
                    {missingGuideCount > 0 && !batchGenerating && (
                        <button
                            onClick={handleBatchGenerate}
                            className="text-xs text-primary-mint hover:underline"
                        >
                            批量摘要 ({missingGuideCount})
                        </button>
                    )}
                    {batchGenerating && (
                        <button
                            onClick={handleStopBatch}
                            className="text-xs text-warning hover:underline flex items-center gap-1"
                        >
                            <Loader2 size={10} className="animate-spin" /> 停止
                        </button>
                    )}
                    {selectedSourceIds.length > 1 && !batchGenerating && (
                        <button
                            onClick={handleBatchArchive}
                            className="text-xs text-destructive hover:underline flex items-center gap-1"
                        >
                            <Archive size={10} /> 批量移除
                        </button>
                    )}
                    {/* Sort dropdown */}
                    <div className="ml-auto flex items-center gap-1">
                        <ArrowUpDown size={10} className="text-text-quaternary" />
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="text-[10px] bg-transparent text-text-tertiary border-none focus:outline-none cursor-pointer"
                        >
                            {Object.entries(SORT_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                        <span className="text-[10px] text-text-quaternary">{selectedSourceIds.length}/{sources.length}</span>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && (
                    <div className="p-4 space-y-3">
                        {[1,2,3].map((i) => (
                            <div key={i} className="space-y-2">
                                <div className="skeleton h-4 w-3/4" />
                                <div className="skeleton h-3 w-1/2" />
                            </div>
                        ))}
                    </div>
                )}
                {!loading && sources.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-text-quaternary p-6">
                        <FileText size={28} />
                        <p className="text-xs text-center">还没有来源。<br />点击右上 + 添加来源</p>
                    </div>
                )}
                {sortedSources.map((s) => (
                    <SourceRow
                        key={s.id}
                        source={s}
                        notebook={notebook}
                        checked={selectedSourceIds.includes(s.id)}
                        onToggle={() => toggleSourceSelected(s.id)}
                        onClick={() => onSelectSource?.(s)}
                    />
                ))}
            </div>

            <AddSourceModal notebook={notebook} open={modalOpen} onClose={() => setModalOpen(false)} onImported={load} />
        </div>
    )
}

// Re-export trash icon for parent panels needing it without re-import
export { Trash2 }
