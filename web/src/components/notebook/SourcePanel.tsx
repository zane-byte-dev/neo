/**
 * SourcePanel — left column of notebook workspace.
 * Lists sources with checkbox selection, context menu (rename/archive),
 * and prominent "添加来源" button opening AddSourceModal.
 */
import React from 'react'
import { FileText, Plus, Check, ArrowUpDown } from 'lucide-react'
import type { SourceMeta } from '../../types'
import { useAppStore } from '../../stores/useAppStore'
import {
    notebookListSources,
    notebookGetSourceGuide,
} from '../../api'
import { AddSourceModal } from './AddSourceModal'
import { SourceRow } from './SourceRow'

interface Props {
    notebook: string
    onSelectSource?: (source: SourceMeta) => void
    hideHeader?: boolean
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

export const SourcePanel: React.FC<Props> = ({ notebook, onSelectSource, hideHeader }) => {
    const { sources, setSources, selectedSourceIds, setSelectedSourceIds, toggleSourceSelected, setSourceGuide, sourceGuides } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [modalOpen, setModalOpen] = React.useState(false)
    const [sortBy, setSortBy] = React.useState<SortOption>('default')

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
        <div className="flex flex-col h-full bg-bg-container">
            {!hideHeader && (
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
            )}

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
                        选择所有来源
                    </button>
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
