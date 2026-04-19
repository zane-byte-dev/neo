/**
 * StudioPanel — right column: notes, mindmap, audio, reports.
 */
import React from 'react'
import { StickyNote, Volume2, Brain, FileText, Loader2, Plus, Trash2, Download, Sparkles, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/useAppStore'
import {
    notebookListNotes, notebookSaveNote, notebookDeleteNote, notebookConvertNoteToSource, notebookNoteQuickAction,
    notebookListArtifacts, notebookGenerateArtifact, notebookDeleteArtifact,
    notebookGenerateOverview, notebookGetConfig,
    type NoteQuickAction,
} from '../../api'
import type { Artifact, NotebookNote } from '../../types'
import { MindMap } from './MindMap'
import { AudioOverview, type AudioLine } from './AudioOverview'

type Tab = 'overview' | 'notes' | 'mindmap' | 'audio' | 'reports'

interface Props { notebook: string }

const REPORT_TYPES: { value: string; label: string }[] = [
    { value: 'briefing', label: '简报文档' },
    { value: 'study-guide', label: '学习指南' },
    { value: 'faq', label: 'FAQ' },
    { value: 'timeline', label: '时间线' },
    { value: 'outline', label: '大纲' },
]

export const StudioPanel: React.FC<Props> = ({ notebook }) => {
    const [tab, setTab] = React.useState<Tab>('overview')
    return (
        <div className="flex flex-col h-full bg-bg-container border-l border-border">
            <div className="h-14 border-b border-border flex items-center gap-1 px-3 shrink-0 overflow-x-auto">
                <TabBtn icon={Sparkles} label="概览"    active={tab === 'overview'} onClick={() => setTab('overview')} />
                <TabBtn icon={StickyNote} label="笔记" active={tab === 'notes'}    onClick={() => setTab('notes')} />
                <TabBtn icon={Brain}      label="思维导图" active={tab === 'mindmap'} onClick={() => setTab('mindmap')} />
                <TabBtn icon={Volume2}    label="音频" active={tab === 'audio'}    onClick={() => setTab('audio')} />
                <TabBtn icon={FileText}   label="报告" active={tab === 'reports'}  onClick={() => setTab('reports')} />
            </div>
            <div className="flex-1 overflow-hidden">
                {tab === 'overview' && <OverviewTab notebook={notebook} />}
                {tab === 'notes'    && <NotesTab notebook={notebook} />}
                {tab === 'mindmap'  && <ArtifactTab notebook={notebook} type="mindmap" />}
                {tab === 'audio'    && <ArtifactTab notebook={notebook} type="audio" />}
                {tab === 'reports'  && <ArtifactTab notebook={notebook} type="report" />}
            </div>
        </div>
    )
}

const TabBtn: React.FC<{ icon: React.ComponentType<{ size?: number }>; label: string; active: boolean; onClick: () => void }> = ({ icon: Icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${active ? 'bg-primary-mint/15 text-primary-mint font-medium' : 'text-text-secondary hover:bg-fill-secondary'}`}
    >
        <Icon size={12} /> {label}
    </button>
)

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
            alert(`生成失败：${(e as Error).message}`)
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
        if (selectedIds.length === 0) { alert('请选择至少一条笔记'); return }
        setActionLoading(true)
        try {
            await notebookNoteQuickAction(notebook, action, selectedIds)
            setSelectedIds([])
            load()
        } catch (e) {
            alert(`失败：${(e as Error).message}`)
        } finally { setActionLoading(false) }
    }

    const convertToSource = async (id: string) => {
        if (!confirm('将此笔记转为来源？')) return
        try {
            await notebookConvertNoteToSource(notebook, id)
            load()
        } catch (e) { alert((e as Error).message) }
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
                                            if (confirm('删除此笔记？')) { await notebookDeleteNote(notebook, n.id); load() }
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
        } catch (e) { alert((e as Error).message) } finally { setSaving(false) }
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

// ── Artifact tab (mindmap / audio / report) ─────────────────────────────────

const ArtifactTab: React.FC<{ notebook: string; type: 'mindmap' | 'audio' | 'report' }> = ({ notebook, type }) => {
    const { notebookArtifacts, setNotebookArtifacts, selectedSourceIds, sources } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [generating, setGenerating] = React.useState(false)
    const [reportSubtype, setReportSubtype] = React.useState('briefing')
    const [reportCustom, setReportCustom] = React.useState('')
    const [viewing, setViewing] = React.useState<Artifact | null>(null)

    const load = React.useCallback(() => {
        setLoading(true)
        notebookListArtifacts(notebook, type).then(setNotebookArtifacts).finally(() => setLoading(false))
    }, [notebook, type, setNotebookArtifacts])

    React.useEffect(load, [load])

    const filtered = notebookArtifacts.filter((a) => a.type === type)

    const generate = async () => {
        setGenerating(true)
        try {
            const artifact = await notebookGenerateArtifact({
                notebook, type,
                sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
                ...(type === 'report' ? {
                    subtype: reportSubtype === 'custom' ? 'custom' : reportSubtype,
                    ...(reportSubtype === 'custom' ? { customPrompt: reportCustom } : {}),
                } : {}),
            })
            setViewing(artifact)
            load()
        } catch (e) {
            alert(`生成失败：${(e as Error).message}`)
        } finally { setGenerating(false) }
    }

    const remove = async (id: string) => {
        if (!confirm('删除？')) return
        await notebookDeleteArtifact(notebook, id)
        if (viewing?.id === id) setViewing(null)
        load()
    }

    if (viewing) {
        return <ArtifactViewer artifact={viewing} onBack={() => setViewing(null)} />
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border shrink-0">
                {type === 'report' && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <select value={reportSubtype} onChange={(e) => setReportSubtype(e.target.value)} className="text-xs bg-fill-secondary border border-border rounded-lg px-2 py-1.5">
                            {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            <option value="custom">自定义</option>
                        </select>
                        {reportSubtype === 'custom' && (
                            <input
                                value={reportCustom}
                                onChange={(e) => setReportCustom(e.target.value)}
                                placeholder="描述你想要的报告…"
                                className="flex-1 min-w-[160px] text-xs bg-fill-secondary border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                            />
                        )}
                    </div>
                )}
                <button
                    onClick={generate}
                    disabled={generating || sources.length === 0 || (type === 'report' && reportSubtype === 'custom' && !reportCustom.trim())}
                    className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90 disabled:opacity-50"
                >
                    {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {generating ? '生成中…' : `生成${type === 'mindmap' ? '思维导图' : type === 'audio' ? '音频概览' : '报告'}`}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {loading && <div className="text-xs text-text-tertiary text-center py-4">加载中…</div>}
                {!loading && filtered.length === 0 && (
                    <div className="text-center text-text-quaternary text-sm py-8">
                        <p>暂无内容，点击上方按钮生成</p>
                    </div>
                )}
                {filtered.map((a) => (
                    <div key={a.id} className="border border-border rounded-xl p-3 hover:bg-fill-secondary/40 cursor-pointer" onClick={() => setViewing(a)}>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium flex-1 truncate">{a.title}</span>
                            <button onClick={(e) => { e.stopPropagation(); remove(a.id) }} className="text-text-tertiary hover:text-destructive">
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
        </div>
    )
}

const ArtifactViewer: React.FC<{ artifact: Artifact; onBack: () => void }> = ({ artifact, onBack }) => {
    const markdown = typeof artifact.data.markdown === 'string' ? artifact.data.markdown : ''
    const script = Array.isArray(artifact.data.script) ? (artifact.data.script as AudioLine[]) : []

    const download = () => {
        let content = ''
        let filename = `${artifact.title}.md`
        if (artifact.type === 'audio') {
            content = JSON.stringify(script, null, 2)
            filename = `${artifact.title}.json`
        } else {
            content = markdown
        }
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename; a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
                <button onClick={onBack} className="text-xs px-2.5 py-1.5 bg-fill-secondary rounded-lg hover:bg-fill">← 返回</button>
                <span className="text-sm font-medium flex-1 truncate">{artifact.title}</span>
                <button onClick={download} className="text-xs text-text-secondary hover:text-text p-1.5 hover:bg-fill-secondary rounded-lg">
                    <Download size={13} />
                </button>
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

