/**
 * StudioPanel — right column: NotebookLM-style card grid + modal actions.
 * Cards open modals for generating artifacts; overview & notes stay as sub-views.
 */
import React from 'react'
import { StickyNote, Volume2, Brain, FileText, Loader2, Plus, Trash2, Download, Sparkles, RefreshCw, ChevronRight, ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/useAppStore'
import {
    notebookListNotes, notebookSaveNote, notebookDeleteNote, notebookConvertNoteToSource, notebookNoteQuickAction,
    notebookListArtifacts, notebookDeleteArtifact,
    notebookGenerateOverview, notebookGetConfig,
    type NoteQuickAction,
} from '../../api'
import type { Artifact, NotebookNote } from '../../types'
import { MindMap } from './MindMap'
import { AudioOverview, type AudioLine } from './AudioOverview'
import { StudioActionModal } from './StudioActionModal'
import { toast } from '../Toast'
import { confirm } from '../ConfirmDialog'

type View = 'home' | 'overview' | 'notes' | 'artifact-view'
type ModalAction = 'audio' | 'mindmap' | 'report' | null

interface Props { notebook: string }

// Card definitions for the grid
interface StudioCard {
    id: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    bg: string
    iconColor: string
    action: 'modal' | 'view'  // modal = open StudioActionModal; view = navigate to sub-view
    modalType?: 'audio' | 'mindmap' | 'report'
    viewId?: View
}

const CARDS: StudioCard[] = [
    { id: 'audio',   icon: Volume2,   label: '音频概览', bg: 'bg-green-50 dark:bg-green-950/30',   iconColor: 'text-green-600 dark:text-green-400',  action: 'modal', modalType: 'audio' },
    { id: 'mindmap', icon: Brain,     label: '思维导图', bg: 'bg-purple-50 dark:bg-purple-950/30',  iconColor: 'text-purple-600 dark:text-purple-400', action: 'modal', modalType: 'mindmap' },
    { id: 'report',  icon: FileText,  label: '报告',     bg: 'bg-blue-50 dark:bg-blue-950/30',     iconColor: 'text-blue-600 dark:text-blue-400',    action: 'modal', modalType: 'report' },
    { id: 'overview', icon: Sparkles, label: '概览',     bg: 'bg-amber-50 dark:bg-amber-950/30',   iconColor: 'text-amber-600 dark:text-amber-400',  action: 'view',  viewId: 'overview' },
    { id: 'notes',   icon: StickyNote, label: '笔记',    bg: 'bg-rose-50 dark:bg-rose-950/30',     iconColor: 'text-rose-600 dark:text-rose-400',    action: 'view',  viewId: 'notes' },
]

export const StudioPanel: React.FC<Props> = ({ notebook }) => {
    const [view, setView] = React.useState<View>('home')
    const [modalAction, setModalAction] = React.useState<ModalAction>(null)
    const [viewingArtifact, setViewingArtifact] = React.useState<Artifact | null>(null)
    const [refreshKey, setRefreshKey] = React.useState(0)

    const openArtifact = (a: Artifact) => {
        setViewingArtifact(a)
        setView('artifact-view')
    }

    const handleCardClick = (card: StudioCard) => {
        if (card.action === 'modal' && card.modalType) {
            setModalAction(card.modalType)
        } else if (card.action === 'view' && card.viewId) {
            setView(card.viewId)
        }
    }

    const handleGenerated = (artifact: Artifact) => {
        setRefreshKey((k) => k + 1)
        openArtifact(artifact)
    }

    if (view === 'artifact-view' && viewingArtifact) {
        return (
            <div className="flex flex-col h-full bg-bg-container border-l border-border">
                <ArtifactViewer artifact={viewingArtifact} onBack={() => { setViewingArtifact(null); setView('home') }} />
            </div>
        )
    }

    if (view === 'overview' || view === 'notes') {
        const label = view === 'overview' ? '概览' : '笔记'
        return (
            <div className="flex flex-col h-full bg-bg-container border-l border-border">
                <SubViewHeader label={label} onBack={() => setView('home')} />
                <div className="flex-1 overflow-hidden">
                    {view === 'overview' && <OverviewTab notebook={notebook} />}
                    {view === 'notes'    && <NotesTab notebook={notebook} />}
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-bg-container border-l border-border">
            <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <Sparkles size={15} className="text-primary-mint" />
                <span className="text-sm font-semibold">Studio</span>
            </div>

            {/* Card grid */}
            <div className="p-3 grid grid-cols-2 gap-2 shrink-0">
                {CARDS.map((card) => (
                    <button
                        key={card.id}
                        onClick={() => handleCardClick(card)}
                        className={`${card.bg} rounded-xl p-3 text-left hover:opacity-80 transition-opacity group`}
                    >
                        <div className="flex items-center justify-between mb-1.5">
                            <card.icon size={16} className={card.iconColor} />
                            <ChevronRight size={14} className="text-text-quaternary group-hover:text-text-tertiary transition-colors" />
                        </div>
                        <span className="text-xs font-medium text-text">{card.label}</span>
                    </button>
                ))}
            </div>

            {/* Generated outputs area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <StudioOutputs key={refreshKey} notebook={notebook} onViewArtifact={openArtifact} />
            </div>

            {/* Add note button */}
            <div className="p-3 shrink-0">
                <button
                    onClick={() => setView('notes')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-text text-bg rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                >
                    <StickyNote size={14} /> 添加笔记
                </button>
            </div>

            {/* Generation modals */}
            {modalAction && (
                <StudioActionModal
                    notebook={notebook}
                    type={modalAction}
                    open={true}
                    onClose={() => setModalAction(null)}
                    onGenerated={handleGenerated}
                />
            )}
        </div>
    )
}

// ── Sub-view header with back button ────────────────────────────────────────

const SubViewHeader: React.FC<{ label: string; onBack: () => void }> = ({ label, onBack }) => (
    <div className="h-14 border-b border-border flex items-center gap-2 px-3 shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary transition-colors">
            <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-semibold">{label}</span>
    </div>
)

// ── Studio outputs (recent artifacts list on home) ──────────────────────────

const StudioOutputs: React.FC<{ notebook: string; onViewArtifact: (a: Artifact) => void }> = ({ notebook, onViewArtifact }) => {
    const { notebookArtifacts, setNotebookArtifacts } = useAppStore()
    const [loading, setLoading] = React.useState(false)

    const load = React.useCallback(() => {
        setLoading(true)
        notebookListArtifacts(notebook).then(setNotebookArtifacts).finally(() => setLoading(false))
    }, [notebook, setNotebookArtifacts])

    React.useEffect(() => { load() }, [load])

    const remove = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (!(await confirm('删除此生成内容？', { destructive: true, confirmText: '删除' }))) return
        await notebookDeleteArtifact(notebook, id)
        load()
    }

    if (loading) {
        return <div className="text-xs text-text-tertiary text-center py-8">加载中…</div>
    }

    if (notebookArtifacts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-quaternary px-6">
                <Sparkles size={28} />
                <p className="text-sm font-medium text-primary-mint">Studio 输出将保存在此处。</p>
                <p className="text-xs text-center">添加来源后，点击即可添加音频概览、学习指南、思维导图等！</p>
            </div>
        )
    }

    return (
        <div className="p-3 space-y-2">
            {notebookArtifacts.map((a) => (
                <div
                    key={a.id}
                    onClick={() => onViewArtifact(a)}
                    className="border border-border rounded-xl p-3 hover:bg-fill-secondary/40 cursor-pointer transition-colors group"
                >
                    <div className="flex items-center gap-2">
                        <ArtifactIcon type={a.type} />
                        <span className="text-sm font-medium flex-1 truncate">{a.title}</span>
                        <button onClick={(e) => remove(e, a.id)} className="text-text-tertiary hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 size={11} />
                        </button>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                        {new Date(a.createdAt).toLocaleString('zh-CN')}
                        {a.subtype && ` · ${a.subtype}`}
                    </p>
                </div>
            ))}
        </div>
    )
}

const ArtifactIcon: React.FC<{ type: string }> = ({ type }) => {
    switch (type) {
        case 'mindmap': return <Brain size={13} className="text-purple-500 shrink-0" />
        case 'audio':   return <Volume2 size={13} className="text-green-500 shrink-0" />
        case 'report':  return <FileText size={13} className="text-blue-500 shrink-0" />
        default:        return <Sparkles size={13} className="text-amber-500 shrink-0" />
    }
}

// ── Overview tab ────────────────────────────────────────────────────────────

const OverviewTab: React.FC<Props> = ({ notebook }) => {
    const { notebookConfig, setNotebookConfig, selectedSourceIds, sources } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [generating, setGenerating] = React.useState(false)

    React.useEffect(() => {
        setLoading(true)
        notebookGetConfig(notebook).then(setNotebookConfig).catch(() => setNotebookConfig(null)).finally(() => setLoading(false))
    }, [notebook, setNotebookConfig])

    const regenerate = async () => {
        setGenerating(true)
        try {
            const { overview } = await notebookGenerateOverview(notebook, selectedSourceIds.length ? selectedSourceIds : undefined)
            setNotebookConfig({ ...notebookConfig, overview, overviewUpdatedAt: new Date().toISOString() })
        } catch (e) {
            toast.error(`生成失败：${(e as Error).message}`)
        } finally { setGenerating(false) }
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold">笔记本概览</h3>
                <button
                    onClick={regenerate}
                    disabled={generating || sources.length === 0}
                    className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary-mint/10 text-primary-mint hover:bg-primary-mint/20 rounded-lg disabled:opacity-50"
                >
                    {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {notebookConfig?.overview ? '重新生成' : '生成'}
                </button>
            </div>
            {loading ? (
                <div className="space-y-2">
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-5/6" />
                    <div className="skeleton h-4 w-4/6" />
                </div>
            ) : notebookConfig?.overview ? (
                <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{notebookConfig.overview}</ReactMarkdown>
                    {notebookConfig.overviewUpdatedAt && (
                        <p className="text-xs text-text-tertiary mt-4">
                            更新于 {new Date(notebookConfig.overviewUpdatedAt).toLocaleString('zh-CN')}
                        </p>
                    )}
                </div>
            ) : (
                <div className="text-center text-text-quaternary text-sm py-8">
                    <Sparkles size={24} className="mx-auto mb-2 text-text-quaternary" />
                    <p>点击上方 "生成" 按钮创建概览</p>
                </div>
            )}
        </div>
    )
}

// ── Notes tab ───────────────────────────────────────────────────────────────

const NotesTab: React.FC<Props> = ({ notebook }) => {
    const { notebookNotes, setNotebookNotes } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [editing, setEditing] = React.useState<NotebookNote | 'new' | null>(null)
    const [selectedIds, setSelectedIds] = React.useState<string[]>([])
    const [actionLoading, setActionLoading] = React.useState(false)

    const load = React.useCallback(() => {
        setLoading(true)
        notebookListNotes(notebook).then(setNotebookNotes).catch(() => setNotebookNotes([])).finally(() => setLoading(false))
    }, [notebook, setNotebookNotes])

    React.useEffect(load, [load])

    const toggle = (id: string) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

    const runQuick = async (action: NoteQuickAction) => {
        if (selectedIds.length === 0) { toast.warning('请选择至少一条笔记'); return }
        setActionLoading(true)
        try {
            await notebookNoteQuickAction(notebook, action, selectedIds)
            setSelectedIds([])
            load()
        } catch (e) {
            toast.error(`失败：${(e as Error).message}`)
        } finally { setActionLoading(false) }
    }

    const convertToSource = async (id: string) => {
        if (!(await confirm('将此笔记转为来源？', { confirmText: '转换' }))) return
        try {
            await notebookConvertNoteToSource(notebook, id)
            load()
        } catch (e) { toast.error((e as Error).message) }
    }

    if (editing !== null) {
        return <NoteEditorInline notebook={notebook} note={editing === 'new' ? null : editing} onSaved={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex flex-wrap gap-1.5 shrink-0">
                <button onClick={() => setEditing('new')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90">
                    <Plus size={11} /> 新建笔记
                </button>
                {selectedIds.length > 0 && (
                    <>
                        <span className="text-xs text-text-tertiary self-center mx-1">已选 {selectedIds.length}</span>
                        <button disabled={actionLoading} onClick={() => runQuick('merge')}       className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">合并</button>
                        <button disabled={actionLoading} onClick={() => runQuick('outline')}     className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">大纲</button>
                        <button disabled={actionLoading} onClick={() => runQuick('feedback')}    className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">反馈</button>
                        <button disabled={actionLoading} onClick={() => runQuick('study-guide')} className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">学习指南</button>
                    </>
                )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {loading && <div className="text-xs text-text-tertiary text-center py-4">加载中…</div>}
                {!loading && notebookNotes.length === 0 && (
                    <div className="text-center text-text-quaternary text-sm py-8">
                        <StickyNote size={24} className="mx-auto mb-2" />
                        <p>还没有笔记</p>
                    </div>
                )}
                {notebookNotes.map((n) => (
                    <div key={n.id} className="border border-border rounded-xl p-3 hover:bg-fill-secondary/40 transition-colors">
                        <div className="flex items-start gap-2">
                            <input type="checkbox" checked={selectedIds.includes(n.id)} onChange={() => toggle(n.id)} className="mt-1 accent-[var(--primary-mint)]" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium flex-1 truncate">{n.title}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${n.source === 'user' ? 'bg-fill text-text-tertiary' : n.source === 'ai-chat' ? 'bg-primary-mint/15 text-primary-mint' : 'bg-orange-500/15 text-orange-600'}`}>
                                        {n.source === 'user' ? '手动' : n.source === 'ai-chat' ? 'AI 对话' : 'AI 生成'}
                                    </span>
                                </div>
                                <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{n.content}</p>
                                <div className="flex items-center gap-2 mt-2">
                                    <button onClick={() => setEditing(n)} className="text-xs text-primary-mint hover:underline">编辑</button>
                                    <button onClick={() => convertToSource(n.id)} className="text-xs text-text-tertiary hover:text-text">→ 转为来源</button>
                                    <button
                                        onClick={async () => {
                                            if (await confirm('删除此笔记？', { destructive: true, confirmText: '删除' })) { await notebookDeleteNote(notebook, n.id); load() }
                                        }}
                                        className="text-xs text-text-tertiary hover:text-destructive ml-auto"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

const NoteEditorInline: React.FC<{ notebook: string; note: NotebookNote | null; onSaved: () => void; onCancel: () => void }> = ({ notebook, note, onSaved, onCancel }) => {
    const [title, setTitle] = React.useState(note?.title ?? '')
    const [content, setContent] = React.useState(note?.content ?? '')
    const [saving, setSaving] = React.useState(false)

    const save = async () => {
        if (!title.trim()) return
        setSaving(true)
        try {
            await notebookSaveNote(notebook, { id: note?.id, title: title.trim(), content, source: note?.source ?? 'user' })
            onSaved()
        } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex gap-2 shrink-0">
                <button onClick={onCancel} className="text-xs px-2.5 py-1.5 bg-fill-secondary rounded-lg hover:bg-fill">取消</button>
                <button onClick={save} disabled={saving || !title.trim()} className="ml-auto text-xs px-2.5 py-1.5 bg-primary-mint text-white rounded-lg disabled:opacity-50">
                    {saving ? <Loader2 size={11} className="animate-spin" /> : '保存'}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-mint/30" />
                <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容 (Markdown)" rows={20} className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none font-mono" />
            </div>
        </div>
    )
}

// ── Simple markdown-to-HTML for export ──────────────────────────────────────

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

function markdownToSimpleHtml(md: string): string {
    // Minimal markdown → HTML conversion for export
    // First escape HTML entities for safety, then apply markdown transforms
    const escaped = escapeHtml(md)
    const lines = escaped.split('\n')
    const result: string[] = []
    let inList = false

    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('### ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h3>${trimmed.slice(4)}</h3>`)
        } else if (trimmed.startsWith('## ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h2>${trimmed.slice(3)}</h2>`)
        } else if (trimmed.startsWith('# ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h1>${trimmed.slice(2)}</h1>`)
        } else if (trimmed.startsWith('- ')) {
            if (!inList) { result.push('<ul>'); inList = true }
            result.push(`<li>${applyInlineFormatting(trimmed.slice(2))}</li>`)
        } else if (trimmed.startsWith('&gt; ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<blockquote>${applyInlineFormatting(trimmed.slice(5))}</blockquote>`)
        } else if (trimmed === '') {
            if (inList) { result.push('</ul>'); inList = false }
            result.push('')
        } else {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<p>${applyInlineFormatting(trimmed)}</p>`)
        }
    }
    if (inList) result.push('</ul>')
    return result.join('\n')
}

function applyInlineFormatting(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
}

// ── Artifact viewer ─────────────────────────────────────────────────────────

const ArtifactViewer: React.FC<{ artifact: Artifact; onBack: () => void }> = ({ artifact, onBack }) => {
    const markdown = typeof artifact.data.markdown === 'string' ? artifact.data.markdown : ''
    const script = Array.isArray(artifact.data.script) ? (artifact.data.script as AudioLine[]) : []

    const download = (format: 'md' | 'json' | 'txt' | 'html') => {
        let content = ''
        let filename = artifact.title
        let mime = 'text/plain'

        if (artifact.type === 'audio') {
            if (format === 'json') {
                content = JSON.stringify(script, null, 2)
                filename += '.json'
                mime = 'application/json'
            } else {
                // Export as readable transcript
                content = script.map((l) => `[${l.speaker}] ${l.text}`).join('\n\n')
                filename += '.txt'
            }
        } else if (format === 'html') {
            // Simple HTML export with basic styling
            const htmlContent = markdownToSimpleHtml(markdown)
            const safeTitle = escapeHtml(artifact.title)
            const safeType = escapeHtml(artifact.subtype ?? artifact.type)
            content = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1a1a1a}h1,h2,h3{margin-top:1.5em}blockquote{border-left:3px solid #34d399;padding-left:1em;color:#555}code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:0.9em}pre{background:#f5f5f5;padding:1em;border-radius:8px;overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f9f9f9}.meta{color:#888;font-size:0.85em;margin-bottom:2em}ul{padding-left:1.5em}</style>
</head>
<body>
<div class="meta">来源：Neo Notebook · ${safeType} · ${new Date(artifact.createdAt).toLocaleString('zh-CN')}</div>
${htmlContent}
</body></html>`
            filename += '.html'
            mime = 'text/html'
        } else {
            // Markdown with metadata header
            const header = `---\ntitle: ${artifact.title}\ntype: ${artifact.type}${artifact.subtype ? `\nsubtype: ${artifact.subtype}` : ''}\ndate: ${new Date(artifact.createdAt).toISOString()}\n---\n\n`
            content = header + markdown
            filename += '.md'
            mime = 'text/markdown'
        }

        const blob = new Blob([content], { type: mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename; a.click()
        URL.revokeObjectURL(url)
    }

    const [exportOpen, setExportOpen] = React.useState(false)
    const exportRef = React.useRef<HTMLDivElement>(null)

    // Close export dropdown on outside click
    React.useEffect(() => {
        if (!exportOpen) return
        const handler = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [exportOpen])

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
                <button onClick={onBack} className="text-xs px-2.5 py-1.5 bg-fill-secondary rounded-lg hover:bg-fill">← 返回</button>
                <span className="text-sm font-medium flex-1 truncate">{artifact.title}</span>
                <div className="relative" ref={exportRef}>
                    <button
                        onClick={() => setExportOpen(!exportOpen)}
                        className="text-xs text-text-secondary hover:text-text p-1.5 hover:bg-fill-secondary rounded-lg flex items-center gap-1"
                    >
                        <Download size={13} />
                        <span className="hidden sm:inline">导出</span>
                    </button>
                    {exportOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-bg-container border border-border rounded-xl py-1 shadow-lg z-50 min-w-[140px] animate-slide-up">
                            <button onClick={() => { download('md'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                📝 Markdown
                            </button>
                            <button onClick={() => { download('html'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                🌐 HTML
                            </button>
                            {artifact.type === 'audio' && (
                                <>
                                    <button onClick={() => { download('json'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                        📋 JSON (脚本)
                                    </button>
                                    <button onClick={() => { download('txt'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                        📄 TXT (对话稿)
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                {artifact.type === 'mindmap' && <MindMap markdown={markdown} />}
                {artifact.type === 'audio' && <AudioOverview script={script} title={artifact.title} />}
                {artifact.type === 'report' && (
                    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 markdown-content text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    )
}

