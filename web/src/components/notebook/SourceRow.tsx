import React from 'react'
import { FileText, Link as LinkIcon, Type, Loader2, Youtube, Check, MoreVertical, Pencil, Archive } from 'lucide-react'
import type { SourceMeta } from '../../types'
import { useAppStore } from '../../stores/useAppStore'
import { notebookGenerateSourceGuide, notebookArchiveSource, notebookRenameSource } from '../../api'
import { toast } from '../Toast'
import { confirm } from '../ConfirmDialog'

const TYPE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    url: LinkIcon,
    youtube: Youtube,
    pdf: FileText,
    text: Type,
    audio: FileText,
    image: FileText,
}

export const SourceRow: React.FC<{
    source: SourceMeta
    notebook: string
    checked: boolean
    onToggle: () => void
    onClick: () => void
}> = ({ source, notebook, checked, onToggle, onClick }) => {
    const { sourceGuides, setSourceGuide, setSources, sources } = useAppStore()
    const guideState = sourceGuides[source.id]   // undefined = loading, null = no guide, SourceGuide = exists
    const Icon = TYPE_ICON[source.type] ?? FileText
    const [generating, setGenerating] = React.useState(false)
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [renaming, setRenaming] = React.useState(false)
    const [renameTitle, setRenameTitle] = React.useState('')
    const menuRef = React.useRef<HTMLDivElement>(null)

    // Close menu on outside click
    React.useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [menuOpen])

    const handleGenerate = async (e: React.MouseEvent) => {
        e.stopPropagation()
        setGenerating(true)
        try {
            const guide = await notebookGenerateSourceGuide(notebook, source.id)
            setSourceGuide(source.id, guide)
        } catch {
            /* failed, stay as null */
        } finally {
            setGenerating(false)
        }
    }

    const handleArchive = async () => {
        setMenuOpen(false)
        if (!(await confirm(`移除来源「${source.title}」？`, { description: '文件不会被删除，仅从列表中隐藏', destructive: true, confirmText: '移除' }))) return
        try {
            await notebookArchiveSource(notebook, source.id)
            setSources(sources.filter((s) => s.id !== source.id))
        } catch (e) { toast.error((e as Error).message) }
    }

    const handleStartRename = () => {
        setMenuOpen(false)
        setRenameTitle(source.title)
        setRenaming(true)
    }

    const handleRename = async () => {
        const newTitle = renameTitle.trim()
        if (!newTitle || newTitle === source.title) { setRenaming(false); return }
        try {
            const updated = await notebookRenameSource(notebook, source.id, newTitle)
            setSources(sources.map((s) => s.id === source.id ? { ...s, title: updated.title } : s))
        } catch (e) { toast.error((e as Error).message) }
        setRenaming(false)
    }

    return (
        <div className="group px-3 py-3 hover:bg-fill-secondary cursor-pointer border-b border-border-secondary last:border-b-0 transition-colors">
            <div className="flex items-start gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); onToggle() }}
                    className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary-mint border-primary-mint' : 'border-border hover:border-primary-mint'}`}
                >
                    {checked && <Check size={11} className="text-white" />}
                </button>
                <div className="flex-1 min-w-0" onClick={onClick}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon size={11} className="text-text-tertiary shrink-0" />
                        <span className="text-xs text-text-tertiary uppercase">{source.type}</span>
                    </div>
                    {renaming ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                                value={renameTitle}
                                onChange={(e) => setRenameTitle(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false) }}
                                className="flex-1 text-sm bg-bg border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-mint/40"
                                autoFocus
                                onBlur={handleRename}
                            />
                        </div>
                    ) : (
                        <div className="text-sm font-medium text-text truncate" title={source.title}>{source.title}</div>
                    )}
                    {guideState && guideState.summary && (
                        <p className="text-xs text-text-tertiary mt-1 line-clamp-2 leading-relaxed">{guideState.summary}</p>
                    )}
                    {guideState === undefined && (
                        <p className="text-xs text-text-quaternary mt-1 italic flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" /> 加载中…
                        </p>
                    )}
                    {guideState === null && !generating && (
                        <button
                            onClick={handleGenerate}
                            className="text-xs text-primary-mint mt-1 hover:underline"
                        >
                            生成摘要
                        </button>
                    )}
                    {generating && (
                        <p className="text-xs text-text-quaternary mt-1 italic flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" /> 正在生成摘要…
                        </p>
                    )}
                </div>
                {/* Context menu trigger */}
                <div className="relative shrink-0" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
                        className="p-1 rounded hover:bg-fill text-text-quaternary hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreVertical size={14} />
                    </button>
                    {menuOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-bg-container border border-border rounded-xl py-1 shadow-lg z-50 min-w-[140px] animate-slide-up">
                            <button
                                onClick={handleStartRename}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors"
                            >
                                <Pencil size={12} /> 重命名来源
                            </button>
                            <button
                                onClick={handleArchive}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-fill-secondary transition-colors"
                            >
                                <Archive size={12} /> 移除来源
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
