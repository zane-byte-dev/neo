/**
 * SourcePanel — left column of notebook workspace.
 * Lists sources, allows selecting (checkbox) and adding new ones
 * (URL / YouTube / text / document upload).
 */
import React from 'react'
import { FileText, Link as LinkIcon, Type, Upload, Plus, Trash2, Loader2, Youtube, Check } from 'lucide-react'
import type { SourceMeta, SourceGuide } from '../../types'
import { useAppStore } from '../../stores/useAppStore'
import {
    notebookListSources,
    notebookImportSource,
    notebookGetSourceGuide,
    uploadFiles,
} from '../../api'

type AddKind = 'url' | 'text' | 'document'

interface Props {
    notebook: string
    onSelectSource?: (source: SourceMeta) => void
}

export const SourcePanel: React.FC<Props> = ({ notebook, onSelectSource }) => {
    const { sources, setSources, selectedSourceIds, setSelectedSourceIds, toggleSourceSelected, setSourceGuide } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [adding, setAdding] = React.useState<AddKind | null>(null)
    const [urlInput, setUrlInput] = React.useState('')
    const [textTitle, setTextTitle] = React.useState('')
    const [textContent, setTextContent] = React.useState('')
    const [importing, setImporting] = React.useState(false)
    const [importError, setImportError] = React.useState('')

    const load = React.useCallback(async () => {
        setLoading(true)
        try {
            const data = await notebookListSources(notebook)
            setSources(data)
            // Select all by default
            setSelectedSourceIds(data.map((s) => s.id))
            // Prefetch guides
            data.forEach((s) => {
                notebookGetSourceGuide(notebook, s.sourceId)
                    .then((g) => setSourceGuide(s.id, g))
                    .catch(() => { /* no guide yet */ })
            })
        } catch (e) {
            console.warn('[SourcePanel] load failed', e)
        } finally {
            setLoading(false)
        }
    }, [notebook, setSources, setSelectedSourceIds, setSourceGuide])

    React.useEffect(() => { load() }, [load])

    const handleImportUrl = async () => {
        if (!urlInput.trim()) return
        setImporting(true); setImportError('')
        try {
            await notebookImportSource({ notebook, kind: 'url', url: urlInput.trim() })
            setUrlInput(''); setAdding(null)
            await load()
        } catch (e) {
            setImportError((e as Error).message)
        } finally { setImporting(false) }
    }

    const handleImportText = async () => {
        if (!textContent.trim()) return
        setImporting(true); setImportError('')
        try {
            await notebookImportSource({ notebook, kind: 'text', title: textTitle.trim() || undefined, content: textContent })
            setTextTitle(''); setTextContent(''); setAdding(null)
            await load()
        } catch (e) {
            setImportError((e as Error).message)
        } finally { setImporting(false) }
    }

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length) return
        setImporting(true); setImportError('')
        try {
            const uploaded = await uploadFiles(Array.from(files))
            for (const f of uploaded) {
                if (f.type === 'document') {
                    await notebookImportSource({
                        notebook, kind: 'document',
                        filename: f.filename,
                        content: f.text,
                        mimeType: f.mimeType,
                    })
                } else if (f.type === 'image') {
                    // Images: not directly supported as "source" text yet; skip
                    continue
                }
            }
            setAdding(null)
            await load()
        } catch (e) {
            setImportError((e as Error).message)
        } finally { setImporting(false) }
    }

    const toggleAll = () => {
        if (selectedSourceIds.length === sources.length) setSelectedSourceIds([])
        else setSelectedSourceIds(sources.map((s) => s.id))
    }

    return (
        <div className="flex flex-col h-full bg-bg-container border-r border-border">
            <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <FileText size={15} className="text-primary-mint" />
                <span className="text-sm font-semibold flex-1">来源 ({sources.length})</span>
                <button
                    onClick={() => setAdding(adding ? null : 'url')}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary hover:text-primary-mint transition-colors"
                    title="添加来源"
                >
                    <Plus size={15} />
                </button>
            </div>

            {adding && (
                <div className="border-b border-border p-3 bg-fill-secondary/40 shrink-0">
                    <div className="flex gap-1 mb-2">
                        {([
                            ['url', LinkIcon, '链接 / YouTube'],
                            ['text', Type, '粘贴文字'],
                            ['document', Upload, '上传文件'],
                        ] as const).map(([k, Icon, label]) => (
                            <button
                                key={k}
                                onClick={() => setAdding(k)}
                                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors ${adding === k ? 'bg-primary-mint/15 text-primary-mint' : 'hover:bg-fill-secondary text-text-secondary'}`}
                            >
                                <Icon size={12} /> {label}
                            </button>
                        ))}
                    </div>
                    {adding === 'url' && (
                        <div className="space-y-2">
                            <input
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                placeholder="https://... 或 YouTube 链接"
                                className="w-full bg-bg-container border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleImportUrl() }}
                            />
                            <button
                                onClick={handleImportUrl}
                                disabled={importing || !urlInput.trim()}
                                className="w-full bg-primary-mint text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50 hover:bg-primary-mint/90"
                            >
                                {importing ? <Loader2 size={12} className="animate-spin mx-auto" /> : '导入'}
                            </button>
                        </div>
                    )}
                    {adding === 'text' && (
                        <div className="space-y-2">
                            <input
                                value={textTitle}
                                onChange={(e) => setTextTitle(e.target.value)}
                                placeholder="标题（可选）"
                                className="w-full bg-bg-container border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                            />
                            <textarea
                                value={textContent}
                                onChange={(e) => setTextContent(e.target.value)}
                                placeholder="粘贴文字内容..."
                                rows={6}
                                className="w-full bg-bg-container border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none"
                            />
                            <button
                                onClick={handleImportText}
                                disabled={importing || !textContent.trim()}
                                className="w-full bg-primary-mint text-white text-xs font-medium py-2 rounded-lg disabled:opacity-50 hover:bg-primary-mint/90"
                            >
                                {importing ? <Loader2 size={12} className="animate-spin mx-auto" /> : '保存'}
                            </button>
                        </div>
                    )}
                    {adding === 'document' && (
                        <div>
                            <label className="block border-2 border-dashed border-border hover:border-primary-mint/50 rounded-lg p-4 text-center cursor-pointer transition-colors">
                                <Upload size={20} className="mx-auto text-text-tertiary mb-1" />
                                <div className="text-xs text-text-secondary">点击上传 PDF / Word / Markdown / 文本</div>
                                <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.docx,.doc,.md,.txt,.markdown"
                                    className="hidden"
                                    onChange={(e) => handleUpload(e.target.files)}
                                />
                            </label>
                            {importing && <div className="mt-2 text-xs text-text-tertiary flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 解析中…</div>}
                        </div>
                    )}
                    {importError && <p className="text-xs text-destructive mt-2">{importError}</p>}
                </div>
            )}

            {sources.length > 0 && (
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
                    <button
                        onClick={toggleAll}
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text"
                    >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedSourceIds.length === sources.length ? 'bg-primary-mint border-primary-mint' : 'border-border'}`}>
                            {selectedSourceIds.length === sources.length && <Check size={10} className="text-white" />}
                        </span>
                        选择全部
                    </button>
                    <span className="ml-auto text-xs text-text-tertiary">已选 {selectedSourceIds.length}</span>
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
                {sources.map((s) => (
                    <SourceRow
                        key={s.id}
                        source={s}
                        checked={selectedSourceIds.includes(s.id)}
                        onToggle={() => toggleSourceSelected(s.id)}
                        onClick={() => onSelectSource?.(s)}
                        onReload={load}
                    />
                ))}
            </div>
        </div>
    )
}

const TYPE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    url: LinkIcon,
    youtube: Youtube,
    pdf: FileText,
    text: Type,
    audio: FileText,
    image: FileText,
}

const SourceRow: React.FC<{
    source: SourceMeta
    checked: boolean
    onToggle: () => void
    onClick: () => void
    onReload: () => void
}> = ({ source, checked, onToggle, onClick }) => {
    const { sourceGuides } = useAppStore()
    const guide: SourceGuide | undefined = sourceGuides[source.id]
    const Icon = TYPE_ICON[source.type] ?? FileText

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
                    <div className="text-sm font-medium text-text truncate" title={source.title}>{source.title}</div>
                    {guide?.summary && (
                        <p className="text-xs text-text-tertiary mt-1 line-clamp-2 leading-relaxed">{guide.summary}</p>
                    )}
                    {!guide && (
                        <p className="text-xs text-text-quaternary mt-1 italic">正在生成摘要…</p>
                    )}
                </div>
            </div>
        </div>
    )
}

// Re-export trash icon for parent panels needing it without re-import
export { Trash2 }
