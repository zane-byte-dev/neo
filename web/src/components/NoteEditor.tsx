import React from 'react'
import { ArrowLeft, Trash2, Check, Loader2, History, MoreHorizontal, Link, Copy, Maximize2, Type, Download, Layers, Languages, Sparkles, RefreshCw, EyeOff, MessageSquarePlus, MessageSquare, CircleDot } from 'lucide-react'
import { fetchMe, notebookRead, notebookUpdate, notebookCreate, notebookDelete, notebookListAnnotations, notebookSaveAnnotation, notebookUpdateAnnotation, notebookDeleteAnnotation, notebookListArtifacts } from '../api'
import { cn } from '../lib/utils'
import type { Artifact, NoteEntry, NotebookAnnotation, NotebookAnnotationAnchor } from '../types'
import { t } from '../i18n'
import { NovelEditor } from './NovelEditor'
import { HistoryDrawer } from './notebook/HistoryDrawer'
import { DocDiffModal } from './notebook/DocDiffModal'
import { ResourcesPanel } from './notebook/ResourcesPanel'
import { StudioActionModal } from './notebook/StudioActionModal'
import { ArtifactViewer } from './notebook/studio/ArtifactViewer'
import { EDIT_ACTIONS, INSIGHT_ACTIONS, type DocEditAction } from './notebook/docActions'
import { ArticleResourceSection, ArticleResourceStatusStrip, filterArticleArtifacts, sourceIdFromArticleId, type ArticleResourceType } from './notebook/ArticleResources'
import { useAppStore } from '../stores/useAppStore'

interface NoteEditorProps {
    note: NoteEntry | null             // null = create new
    notebook?: string                  // target notebook when creating new
    onBack: () => void
    onSaved: (entry: NoteEntry) => void
    onDeleted?: (id: string) => void
    onDuplicated?: (entry: NoteEntry) => void
    /**
     * When true: enables Notion-style auto-save (debounce 1.5s after last change).
     * Hides the manual Save button; shows a subtle status indicator instead.
     * Back button is also hidden (parent controls navigation).
     */
    autoSave?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface AnnotationDraft {
    quote: string
    anchor: NotebookAnnotationAnchor
}

function toTime(value: string | number | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function formatShortDate(value: string | number | null | undefined): string {
    const time = toTime(value)
    if (!time) return '未知'
    const date = new Date(time)
    const now = new Date()
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
        ? { month: 'numeric', day: 'numeric' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' }
    return date.toLocaleDateString('zh-CN', options)
}

function formatRelativeTime(value: string | number | null | undefined): string {
    const time = toTime(value)
    if (!time) return '未知时间'
    const diffMs = Math.max(0, Date.now() - time)
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    if (diffMs < minute) return '刚刚'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
    return `${Math.floor(diffMs / day)} 天前`
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ note, notebook = 'personal', onBack, onSaved, onDeleted, onDuplicated, autoSave = false }) => {
    const [title, setTitle] = React.useState(note?.title ?? '')
    const [author, setAuthor] = React.useState(note?.author ?? '')
    const [date] = React.useState(note?.date ?? new Date().toISOString().split('T')[0])
    const [source] = React.useState(note?.source ?? '')
    const [summary, setSummary] = React.useState(note?.summary ?? '')
    const [tags] = React.useState(note?.tags ?? '')
    const [content, setContent] = React.useState('')
    const [loading, setLoading] = React.useState(!!note)
    const [saving, setSaving] = React.useState(false)
    const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle')
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [historyOpen, setHistoryOpen] = React.useState(false)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const [currentDisplayName, setCurrentDisplayName] = React.useState<string | null>(null)
    // Display preferences (localStorage persisted)
    const [smallText, setSmallText] = React.useState(() => localStorage.getItem('neo:editor:smallText') === '1')
    const [fullWidth, setFullWidth] = React.useState(() => localStorage.getItem('neo:editor:fullWidth') === '1')
    // Action feedback
    const [copyLinkDone, setCopyLinkDone] = React.useState(false)
    const [duplicating, setDuplicating] = React.useState(false)
    // Resources panel (Studio overlay)
    const [resourcesOpen, setResourcesOpen] = React.useState(false)
    const [artifactsLoading, setArtifactsLoading] = React.useState(false)
    const [allArtifacts, setAllArtifacts] = React.useState<Artifact[]>([])
    const [viewingArticleArtifact, setViewingArticleArtifact] = React.useState<Artifact | null>(null)
    const [articleResourceAction, setArticleResourceAction] = React.useState<ArticleResourceType | null>(null)
    // Diff modal (AI edit actions from more menu)
    const [diffAction, setDiffAction] = React.useState<{ action: DocEditAction; content: string } | null>(null)
    const [annotations, setAnnotations] = React.useState<NotebookAnnotation[]>([])
    const [annotationsExpanded, setAnnotationsExpanded] = React.useState(false)
    const [annotationDraft, setAnnotationDraft] = React.useState<AnnotationDraft | null>(null)
    const [annotationBody, setAnnotationBody] = React.useState('')
    const [annotationSaving, setAnnotationSaving] = React.useState(false)
    const [focusRange, setFocusRange] = React.useState<{ startOffset: number; endOffset: number; requestId: number } | null>(null)
    const focusRequestIdRef = React.useRef(0)
    // Inline summary state
    type SummaryState = 'empty' | 'generating' | 'done'
    const [summaryState, setSummaryState] = React.useState<SummaryState>(() => (note?.summary ?? '').trim() ? 'done' : 'empty')
    const [summaryText, setSummaryText] = React.useState(note?.summary ?? '')
    const [summaryCollapsed, setSummaryCollapsed] = React.useState(() =>
        note ? localStorage.getItem(`neo:editor:summaryCollapsed:${note.id}`) === '1' : false
    )
    const titleRef = React.useRef<HTMLTextAreaElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const autoSaveTimerRef = React.useRef<number | null>(null)
    const isDirtyRef = React.useRef(false)
    const wasResourcesOpenRef = React.useRef(false)
    // Keep latest field values accessible in auto-save callback without stale closures
    const fieldsRef = React.useRef({ title, author, date, source, summary, tags, content })
    React.useEffect(() => {
        fieldsRef.current = { title, author, date, source, summary, tags, content }
    })

    const { setPendingQuickReply } = useAppStore()

    React.useEffect(() => {
        let cancelled = false
        fetchMe()
            .then((me) => {
                if (cancelled) return
                setCurrentDisplayName(me.displayName)
                if (!note && !fieldsRef.current.author.trim() && me.displayName) {
                    setAuthor(me.displayName)
                }
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [note])

    React.useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [menuOpen])

    // Auto-expand content textarea to fit content (avoids internal scroll in textarea)
    // Auto-focus title for new notes
    React.useEffect(() => {
        if (!note) {
            setTimeout(() => titleRef.current?.focus(), 50)
        }
    }, [])

    // Cmd+S to save
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault()
                if (fieldsRef.current.title.trim()) void handleSave()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Load full content for existing note
    React.useEffect(() => {
        if (!note) return
        setLoading(true)
        notebookRead(note.id)
            .then((data) => {
                const full = data as NoteEntry
                setContent(full.content ?? '')
            })
            .catch(() => setContent(''))
            .finally(() => setLoading(false))
    }, [note?.id])

    React.useEffect(() => {
        if (!note) {
            setAnnotations([])
            return
        }
        let cancelled = false
        notebookListAnnotations(note.notebook ?? notebook, note.id)
            .then((items) => { if (!cancelled) setAnnotations(items) })
            .catch(() => { if (!cancelled) setAnnotations([]) })
        return () => { cancelled = true }
    }, [note, notebook])

    const loadArtifacts = React.useCallback(async () => {
        if (!note) {
            setAllArtifacts([])
            setArtifactsLoading(false)
            return
        }
        setArtifactsLoading(true)
        try {
            const artifacts = await notebookListArtifacts(note.notebook ?? notebook)
            setAllArtifacts(artifacts)
        } catch {
            setAllArtifacts([])
        } finally {
            setArtifactsLoading(false)
        }
    }, [note, notebook])

    React.useEffect(() => {
        void loadArtifacts()
    }, [loadArtifacts])

    React.useEffect(() => {
        if (wasResourcesOpenRef.current && !resourcesOpen) {
            void loadArtifacts()
        }
        wasResourcesOpenRef.current = resourcesOpen
    }, [resourcesOpen, loadArtifacts])

    // Reset dirty flag on note change (remount via key=)
    React.useEffect(() => {
        isDirtyRef.current = false
        setSaveStatus('idle')
    }, [note?.id])

    // Cleanup auto-save timer on unmount
    React.useEffect(() => () => {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }, [])

    const handleSave = React.useCallback(async () => {
        const f = fieldsRef.current
        if (!f.title.trim()) return
        setSaving(true)
        setSaveStatus('saving')
        try {
            const payload = {
                title: f.title.trim(),
                author: f.author.trim() || null,
                date: f.date.trim() || null,
                source: f.source.trim() || null,
                summary: f.summary.trim() || null,
                tags: f.tags.trim() || null,
                content: f.content,
            }
            const result = note
                ? await notebookUpdate(note.id, payload)
                : await notebookCreate(notebook, payload)
            isDirtyRef.current = false
            setSaveStatus('saved')
            onSaved(result)
            // Fade "saved" indicator after 2.5s
            setTimeout(() => setSaveStatus('idle'), 2500)
        } catch {
            setSaveStatus('error')
        } finally {
            setSaving(false)
        }
    }, [note, notebook, onSaved])

    // Schedule auto-save after field changes
    const scheduleAutoSave = React.useCallback(() => {
        if (!autoSave || !note) return          // only auto-save existing notes
        isDirtyRef.current = true
        setSaveStatus('idle')
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = window.setTimeout(() => void handleSave(), 1500)
    }, [autoSave, note, handleSave])

    const handleDelete = async () => {
        if (!note || !confirmDelete) return
        try {
            await notebookDelete(note.id)
            onDeleted?.(note.id)
        } catch { /* ignore */ }
    }

    const handleCopyLink = async () => {
        if (!note) return
        const url = `${window.location.origin}/notebook/${encodeURIComponent(note.notebook ?? notebook)}?article=${encodeURIComponent(note.id)}`
        await navigator.clipboard.writeText(url).catch(() => {})
        setCopyLinkDone(true)
        setTimeout(() => setCopyLinkDone(false), 2000)
    }

    const handleDuplicate = async () => {
        if (!note) return
        setDuplicating(true)
        try {
            const f = fieldsRef.current
            const entry = await notebookCreate(note.notebook ?? notebook, {
                title: `${f.title.trim()} 副本`,
                author: f.author.trim() || null,
                date: f.date || null,
                source: f.source || null,
                summary: f.summary || null,
                tags: f.tags || null,
                content: f.content,
            })
            onDuplicated?.(entry)
        } catch { /* ignore */ } finally {
            setDuplicating(false)
            setMenuOpen(false)
        }
    }

    const handleExport = () => {
        if (!note) return
        const f = fieldsRef.current
        const lines: string[] = ['---']
        if (f.title) lines.push(`title: "${f.title.replace(/"/g, '\\"')}"`)
        if (f.author) lines.push(`author: ${f.author}`)
        if (f.date) lines.push(`date: ${f.date}`)
        lines.push('---', '', f.content)
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${f.title.trim() || 'article'}.md`
        a.click()
        URL.revokeObjectURL(url)
        setMenuOpen(false)
    }

    const toggleSmallText = () => {
        setSmallText((v) => { localStorage.setItem('neo:editor:smallText', v ? '' : '1'); return !v })
    }
    const toggleFullWidth = () => {
        setFullWidth((v) => { localStorage.setItem('neo:editor:fullWidth', v ? '' : '1'); return !v })
    }

    // ── Inline summary ────────────────────────────────────────────────────────

    const handleGenerateSummary = React.useCallback(async () => {
        if (!note) return
        setSummaryState('generating')
        try {
            const MAX = 6000
            const truncated = fieldsRef.current.content.length > MAX
                ? fieldsRef.current.content.slice(0, MAX) + '\n\n[内容已截断…]'
                : fieldsRef.current.content
            const prompt = `请为以下文章「${fieldsRef.current.title}」生成一段简洁的摘要（不超过 150 字），概括核心内容。只输出摘要文本，不要解释。\n\n---\n\n${truncated}`
            const res = await fetch('/api/generate', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, command: 'zap', instruction: '生成摘要' }),
            })
            if (!res.ok) throw new Error('请求失败')
            const text = await res.text()
            const trimmed = text.trim()
            setSummaryText(trimmed)
            setSummary(trimmed)
            setSummaryState('done')
            setSummaryCollapsed(false)
            // Persist to note
            await notebookUpdate(note.id, { summary: trimmed })
        } catch {
            setSummaryState('empty')
        }
    }, [note])

    const handleRegenerateSummary = () => {
        setSummaryText('')
        setSummary('')
        setSummaryState('empty')
        void handleGenerateSummary()
    }

    const handleHideSummary = () => {
        setSummaryCollapsed(true)
        if (note) localStorage.setItem(`neo:editor:summaryCollapsed:${note.id}`, '1')
    }

    const handleShowSummary = () => {
        setSummaryCollapsed(false)
        if (note) localStorage.removeItem(`neo:editor:summaryCollapsed:${note.id}`)
    }

    // ── AI edit actions (more menu) ───────────────────────────────────────────

    const handleAiEditAction = (action: DocEditAction) => {
        setMenuOpen(false)
        setDiffAction({ action, content: fieldsRef.current.content })
    }

    const handleAiInsightTranslate = () => {
        setMenuOpen(false)
        const MAX = 6000
        const truncated = fieldsRef.current.content.length > MAX
            ? fieldsRef.current.content.slice(0, MAX) + '\n\n[内容已截断…]'
            : fieldsRef.current.content
        const insightAction = INSIGHT_ACTIONS.find(a => a.id === 'translate')
        if (insightAction) {
            setPendingQuickReply(insightAction.buildPrompt(fieldsRef.current.title, truncated))
        }
    }

    const handleAnnotateSelection = React.useCallback((selection: AnnotationDraft) => {
        setAnnotationDraft(selection)
        setAnnotationBody('')
        setAnnotationsExpanded(true)
    }, [])

    const handleSaveAnnotation = React.useCallback(async () => {
        if (!note || !annotationDraft || !annotationBody.trim()) return
        setAnnotationSaving(true)
        try {
            const saved = await notebookSaveAnnotation(note.notebook ?? notebook, {
                articleId: note.id,
                kind: 'highlight',
                quote: annotationDraft.quote,
                anchor: annotationDraft.anchor,
                body: annotationBody.trim(),
                author: currentDisplayName,
            })
            setAnnotations((items) => [...items, saved].sort((a, b) => a.createdAt - b.createdAt))
            setAnnotationDraft(null)
            setAnnotationBody('')
        } catch {
            // keep draft open for retry
        } finally {
            setAnnotationSaving(false)
        }
    }, [annotationBody, annotationDraft, currentDisplayName, note, notebook])

    const handleToggleAnnotationStatus = React.useCallback(async (annotation: NotebookAnnotation) => {
        if (!note) return
        const status = annotation.status === 'open' ? 'resolved' : 'open'
        try {
            const updated = await notebookUpdateAnnotation(note.notebook ?? notebook, note.id, annotation.id, { status })
            setAnnotations((items) => items.map((item) => item.id === updated.id ? updated : item))
        } catch { /* ignore */ }
    }, [note, notebook])

    const handleDeleteAnnotation = React.useCallback(async (annotation: NotebookAnnotation) => {
        if (!note) return
        try {
            await notebookDeleteAnnotation(note.notebook ?? notebook, note.id, annotation.id)
            setAnnotations((items) => items.filter((item) => item.id !== annotation.id))
        } catch { /* ignore */ }
    }, [note, notebook])

    const handleJumpToAnnotation = React.useCallback((annotation: NotebookAnnotation) => {
        const startOffset = annotation.anchor.startOffset
        const endOffset = annotation.anchor.endOffset
        if (typeof startOffset !== 'number' || typeof endOffset !== 'number') return
        focusRequestIdRef.current += 1
        setFocusRange({ startOffset, endOffset, requestId: focusRequestIdRef.current })
    }, [])

    const articleSourceId = React.useMemo(() => sourceIdFromArticleId(note?.id), [note?.id])
    const articleArtifacts = React.useMemo(() => filterArticleArtifacts(allArtifacts, note?.id), [allArtifacts, note?.id])
    const libraryArtifactCount = Math.max(0, allArtifacts.length - articleArtifacts.length)

    const handleOpenArticleArtifact = React.useCallback((artifact: Artifact) => {
        setResourcesOpen(false)
        setViewingArticleArtifact(artifact)
    }, [])

    const handleGenerateArticleArtifact = React.useCallback((type: ArticleResourceType) => {
        if (!articleSourceId) return
        setResourcesOpen(false)
        setViewingArticleArtifact(null)
        setArticleResourceAction(type)
    }, [articleSourceId])

    const handleArticleArtifactGenerated = React.useCallback((artifact: Artifact) => {
        setAllArtifacts((items) => [artifact, ...items.filter((item) => item.id !== artifact.id)])
        setViewingArticleArtifact(artifact)
        setArticleResourceAction(null)
    }, [])

    const creatorName = author.trim() || currentDisplayName || '未知'
    const editorName = currentDisplayName || creatorName
    const createdTime = note?.createdAt ?? date
    const updatedTime = note?.updatedAt ?? createdTime

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#191919] relative">
            {/* ── Top action bar ── */}
            <div className="shrink-0 flex items-center gap-2 px-4 h-10 border-b border-gray-100 dark:border-white/8">
                {/* Left: back + title breadcrumb */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {!autoSave && (
                        <button
                            onClick={onBack}
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                        >
                            <ArrowLeft size={14} />
                        </button>
                    )}
                    {/* Title in action bar */}
                    <span className="text-[13px] text-text-secondary truncate leading-none select-none">
                        {title.trim() || <span className="text-text-quaternary italic">无标题</span>}
                    </span>
                    {/* Auto-save status */}
                    {autoSave && (
                        <span className={cn(
                            'shrink-0 flex items-center gap-1 text-[11px] transition-opacity duration-500',
                            saveStatus === 'idle' ? 'opacity-0' : 'opacity-100',
                            saveStatus === 'saving' && 'text-text-quaternary',
                            saveStatus === 'saved' && 'text-emerald-500 dark:text-emerald-400',
                            saveStatus === 'error' && 'text-rose-500',
                        )}>
                            {saveStatus === 'saving' && <Loader2 size={11} className="animate-spin" />}
                            {saveStatus === 'saved' && <Check size={11} />}
                            {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : ''}
                        </span>
                    )}
                </div>

                {/* Right: action buttons */}
                <div className="shrink-0 flex items-center gap-0.5">
                    {!autoSave && (
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || !title.trim()}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md transition-colors font-medium',
                                saving || !title.trim()
                                    ? 'bg-gray-100 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                                    : 'bg-[#2ecc71] hover:bg-[#27ae60] text-white'
                            )}
                        >
                            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                            {saving ? t('saving') : t('save')}
                        </button>
                    )}
                    {/* Resources (Studio overlay) icon — only for saved notes */}
                    {note && (
                        <button
                            onClick={() => setResourcesOpen((v) => !v)}
                            className={cn(
                                'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
                                resourcesOpen
                                    ? 'bg-primary-mint/15 text-primary-mint'
                                    : 'text-gray-400 hover:text-primary-mint hover:bg-primary-mint/10'
                            )}
                            title="资源"
                        >
                            <Layers size={14} />
                        </button>
                    )}
                    {/* ··· menu */}
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => { setMenuOpen((v) => !v); setConfirmDelete(false) }}
                            className={cn(
                                'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
                                menuOpen
                                    ? 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'
                            )}
                            title="更多操作"
                        >
                            <MoreHorizontal size={14} />
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-[220px] rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#242424] shadow-2xl overflow-hidden z-50 animate-slide-up py-1">
                                {/* Activity info */}
                                {note && (
                                    <>
                                        <div className="px-3 pt-2 pb-1.5 flex flex-col gap-0.5">
                                            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-0.5">活动</span>
                                            <ActivityRow label="编辑者" name={editorName} time={formatRelativeTime(updatedTime)} />
                                            <ActivityRow label="创建者" name={creatorName} time={formatShortDate(createdTime)} />
                                        </div>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* Actions */}
                                        <button
                                            onClick={handleCopyLink}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            {copyLinkDone
                                                ? <Check size={14} className="text-emerald-500 shrink-0" />
                                                : <Link size={14} className="text-text-quaternary shrink-0" />
                                            }
                                            {copyLinkDone ? '已复制' : '拷贝链接'}
                                        </button>
                                        <button
                                            onClick={handleDuplicate}
                                            disabled={duplicating}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                                        >
                                            {duplicating
                                                ? <Loader2 size={14} className="text-text-quaternary shrink-0 animate-spin" />
                                                : <Copy size={14} className="text-text-quaternary shrink-0" />
                                            }
                                            创建副本
                                        </button>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* Display prefs */}
                                        <button
                                            onClick={toggleSmallText}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <Type size={14} className="text-text-quaternary shrink-0" />
                                            <span className="flex-1 text-left">小字号</span>
                                            <ToggleSwitch on={smallText} />
                                        </button>
                                        <button
                                            onClick={toggleFullWidth}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <Maximize2 size={14} className="text-text-quaternary shrink-0" />
                                            <span className="flex-1 text-left">全宽</span>
                                            <ToggleSwitch on={fullWidth} />
                                        </button>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* Export */}
                                        <button
                                            onClick={handleExport}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <Download size={14} className="text-text-quaternary shrink-0" />
                                            导出 Markdown
                                        </button>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* Version history */}
                                        <button
                                            onClick={() => { setMenuOpen(false); setHistoryOpen(true) }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <History size={14} className="text-text-quaternary shrink-0" />
                                            版本历史
                                        </button>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* AI actions */}
                                        <div className="px-3 pt-1.5 pb-0.5">
                                            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">AI 助手</span>
                                        </div>
                                        {EDIT_ACTIONS.map((action) => (
                                            <button
                                                key={action.id}
                                                onClick={() => handleAiEditAction(action)}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                            >
                                                <action.icon size={14} className={cn(action.iconColor, 'shrink-0')} />
                                                {action.label}
                                            </button>
                                        ))}
                                        <button
                                            onClick={handleAiInsightTranslate}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <Languages size={14} className="text-amber-500 shrink-0" />
                                            翻译英文
                                        </button>
                                        <div className="my-1 border-t border-gray-100 dark:border-white/8" />
                                        {/* Delete */}
                                        {confirmDelete ? (
                                            <div className="px-3 py-2 flex items-center gap-2">
                                                <span className="text-[12px] text-text-secondary flex-1">确定删除？</span>
                                                <button
                                                    onClick={() => { void handleDelete(); setMenuOpen(false) }}
                                                    className="px-2 py-1 text-[11px] bg-red-500 text-white rounded-md font-medium hover:bg-red-600 transition-colors"
                                                >
                                                    删除
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDelete(false)}
                                                    className="px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"
                                                >
                                                    取消
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setConfirmDelete(true)}
                                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                            >
                                                <Trash2 size={14} className="shrink-0" />
                                                移至垃圾箱
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Document body: single full-width scroll container ── */}
            <div className="flex-1 overflow-y-auto">
                {/* Centered content column — fullWidth removes max-w constraint */}
                <div className={cn(
                    'w-full mx-auto pt-14 pb-20',
                    fullWidth ? 'px-12' : 'max-w-[46rem] px-16',
                    smallText ? 'text-sm' : '',
                )}>

                    {/* Title — part of the document flow */}
                    <textarea
                        ref={titleRef}
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value)
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                            scheduleAutoSave()
                        }}
                        placeholder="无标题"
                        rows={1}
                        className={cn(
                            'w-full bg-transparent font-bold outline-none resize-none leading-[1.3] mb-1 placeholder:text-gray-200 dark:placeholder:text-white/15 text-[#1a1a1a] dark:text-[#e8e8e8] overflow-hidden',
                            smallText ? 'text-[1.5rem]' : 'text-[2rem]',
                        )}
                        style={{ minHeight: smallText ? '2rem' : '2.6rem' }}
                    />

                    {/* Divider between title and body — subtle, like Notion */}
                    <div className="mb-4 mt-2" />

                    {/* ── Inline summary block ── */}
                    {note && summaryState === 'empty' && (
                        <button
                            onClick={() => void handleGenerateSummary()}
                            className="w-full mb-6 flex items-center gap-2 px-3 h-9 rounded-lg border border-dashed border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/3 text-text-quaternary hover:text-text-tertiary hover:border-gray-300 dark:hover:border-white/20 transition-colors text-[12px]"
                        >
                            <Sparkles size={12} className="text-primary-mint shrink-0" />
                            生成摘要
                            <span className="text-[11px] text-text-quaternary">· 点击获取 AI 概要</span>
                        </button>
                    )}
                    {note && summaryState === 'generating' && (
                        <div className="w-full mb-6 flex items-center gap-2 px-3 h-9 rounded-lg border border-dashed border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/3 text-text-quaternary text-[12px]">
                            <Loader2 size={12} className="text-primary-mint shrink-0 animate-spin" />
                            正在生成摘要…
                        </div>
                    )}
                    {note && summaryState === 'done' && !summaryCollapsed && (
                        <div className="w-full mb-6 rounded-xl bg-primary-mint/8 border-l-2 border-primary-mint pl-3 pr-3 py-2.5 flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                                <Sparkles size={11} className="text-primary-mint shrink-0" />
                                <span className="text-[11px] font-semibold text-primary-mint flex-1">摘要</span>
                                <button
                                    onClick={handleRegenerateSummary}
                                    className="p-1 rounded text-text-quaternary hover:text-text-secondary hover:bg-white/20 transition-colors"
                                    title="重新生成"
                                >
                                    <RefreshCw size={11} />
                                </button>
                                <button
                                    onClick={handleHideSummary}
                                    className="p-1 rounded text-text-quaternary hover:text-text-secondary hover:bg-white/20 transition-colors"
                                    title="隐藏"
                                >
                                    <EyeOff size={11} />
                                </button>
                            </div>
                            <p className="text-[13px] text-text-secondary leading-relaxed">{summaryText}</p>
                        </div>
                    )}

                    {note && (
                        <ArticleResourceStatusStrip
                            summaryState={summaryState}
                            articleArtifacts={articleArtifacts}
                            libraryArtifactCount={libraryArtifactCount}
                            loading={artifactsLoading}
                            onShowSummary={handleShowSummary}
                            onGenerateSummary={() => void handleGenerateSummary()}
                            onOpenArtifact={handleOpenArticleArtifact}
                            onGenerateArtifact={handleGenerateArticleArtifact}
                            onOpenLibrary={() => setResourcesOpen(true)}
                        />
                    )}

                    {note && (
                        <ArticleAnnotationsBlock
                            annotations={annotations}
                            expanded={annotationsExpanded}
                            draft={annotationDraft}
                            body={annotationBody}
                            saving={annotationSaving}
                            onToggleExpanded={() => setAnnotationsExpanded((v) => !v)}
                            onBodyChange={setAnnotationBody}
                            onSave={() => void handleSaveAnnotation()}
                            onCancelDraft={() => { setAnnotationDraft(null); setAnnotationBody('') }}
                            onJump={handleJumpToAnnotation}
                            onToggleStatus={(annotation) => void handleToggleAnnotationStatus(annotation)}
                            onDelete={(annotation) => void handleDeleteAnnotation(annotation)}
                        />
                    )}

                    {/* Content — Novel rich-text editor */}
                    {loading ? (
                        <div className="flex items-center gap-2 text-gray-300">
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                        </div>
                    ) : (
                        <>
                            <NovelEditor
                                key={note?.id ?? 'new'}
                                initialContent={content}
                                placeholder="开始写作… 输入 / 插入块"
                                onChange={(md) => {
                                    setContent(md)
                                    scheduleAutoSave()
                                }}
                                onAnnotateSelection={note ? handleAnnotateSelection : undefined}
                                focusRange={focusRange}
                                className="pb-8"
                            />
                            {note && (
                                <ArticleResourceSection
                                    articleArtifacts={articleArtifacts}
                                    libraryArtifactCount={libraryArtifactCount}
                                    loading={artifactsLoading}
                                    onOpenArtifact={handleOpenArticleArtifact}
                                    onGenerateArtifact={handleGenerateArticleArtifact}
                                    onOpenLibrary={() => setResourcesOpen(true)}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
            {historyOpen && note && (
                <HistoryDrawer
                    note={note}
                    currentContent={content}
                    onClose={() => setHistoryOpen(false)}
                    onRestored={(entry) => {
                        setContent(entry.content ?? '')
                        onSaved(entry)
                        setHistoryOpen(false)
                    }}
                />
            )}
            {/* AI edit diff modal */}
            {diffAction && note && (
                <DocDiffModal
                    note={note}
                    actionLabel={diffAction.action.label}
                    content={diffAction.content}
                    instruction={diffAction.action.editInstruction}
                    onApply={async (noteId, newContent) => {
                        await notebookUpdate(noteId, { content: newContent })
                        setContent(newContent)
                    }}
                    onClose={() => setDiffAction(null)}
                />
            )}
            {/* Resources panel overlay */}
            {resourcesOpen && note && (
                <>
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 z-30 bg-black/10"
                        onClick={() => setResourcesOpen(false)}
                    />
                    {/* Panel */}
                    <div className="absolute right-0 top-0 h-full w-[320px] z-40 shadow-2xl animate-slide-in-right">
                        <ResourcesPanel
                            notebook={note.notebook ?? notebook}
                            onClose={() => setResourcesOpen(false)}
                        />
                    </div>
                </>
            )}
            {viewingArticleArtifact && (
                <>
                    <div
                        className="absolute inset-0 z-30 bg-black/10"
                        onClick={() => setViewingArticleArtifact(null)}
                    />
                    <div className="absolute right-0 top-0 h-full w-full sm:w-[640px] z-40 shadow-2xl animate-slide-in-right bg-bg-container">
                        <ArtifactViewer
                            artifact={viewingArticleArtifact}
                            onBack={() => setViewingArticleArtifact(null)}
                            onRegenerate={(type) => {
                                setViewingArticleArtifact(null)
                                setArticleResourceAction(type as ArticleResourceType)
                            }}
                        />
                    </div>
                </>
            )}
            {articleResourceAction && note && articleSourceId && (
                <StudioActionModal
                    notebook={note.notebook ?? notebook}
                    type={articleResourceAction}
                    open={true}
                    onClose={() => setArticleResourceAction(null)}
                    onGenerated={handleArticleArtifactGenerated}
                    sourceIdsOverride={[articleSourceId]}
                    primaryArticleIdOverride={note.id}
                    sourceScopeLabel="本篇文章"
                />
            )}
        </div>
    )
}

const ArticleAnnotationsBlock: React.FC<{
    annotations: NotebookAnnotation[]
    expanded: boolean
    draft: AnnotationDraft | null
    body: string
    saving: boolean
    onToggleExpanded: () => void
    onBodyChange: (value: string) => void
    onSave: () => void
    onCancelDraft: () => void
    onJump: (annotation: NotebookAnnotation) => void
    onToggleStatus: (annotation: NotebookAnnotation) => void
    onDelete: (annotation: NotebookAnnotation) => void
}> = ({
    annotations,
    expanded,
    draft,
    body,
    saving,
    onToggleExpanded,
    onBodyChange,
    onSave,
    onCancelDraft,
    onJump,
    onToggleStatus,
    onDelete,
}) => {
    const openCount = annotations.filter((annotation) => annotation.status === 'open').length
    if (!draft && annotations.length === 0) {
        return (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-dashed border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/3 px-3 py-2 text-[12px] text-text-quaternary">
                <MessageSquarePlus size={13} className="text-primary-mint shrink-0" />
                选中正文后点击气泡菜单里的“批注”，即可把想法贴回原文。
            </div>
        )
    }

    return (
        <div className="mb-5 rounded-xl border border-primary-mint/20 bg-primary-mint/6 overflow-hidden">
            <button
                onClick={onToggleExpanded}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary-mint/6 transition-colors"
            >
                <MessageSquare size={13} className="text-primary-mint shrink-0" />
                <span className="text-[12px] font-semibold text-text flex-1">文章批注</span>
                <span className="text-[11px] text-text-tertiary" aria-label={`${annotations.length} 条批注，${openCount} 条未解决`}>
                    {annotations.length} 条 · {openCount} 未解决
                </span>
            </button>
            {(expanded || draft) && (
                <div className="border-t border-primary-mint/15 px-3 py-3 space-y-3">
                    {draft && (
                        <div className="rounded-lg bg-white/70 dark:bg-black/10 border border-primary-mint/20 p-3">
                            <div className="text-[11px] font-semibold text-primary-mint mb-1">新批注</div>
                            <blockquote className="text-[12px] text-text-secondary border-l-2 border-primary-mint/50 pl-2 line-clamp-2">
                                {draft.quote}
                            </blockquote>
                            <textarea
                                value={body}
                                onChange={(e) => onBodyChange(e.target.value)}
                                placeholder="写下你的想法、问题或判断…"
                                rows={3}
                                className="mt-2 w-full resize-none rounded-lg border border-border bg-bg-container px-2.5 py-2 text-[13px] text-text outline-none focus:border-primary-mint"
                                autoFocus
                            />
                            <div className="mt-2 flex justify-end gap-2">
                                <button
                                    onClick={onCancelDraft}
                                    className="px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-fill rounded-md transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={onSave}
                                    disabled={saving || !body.trim()}
                                    className="px-3 py-1.5 text-[12px] rounded-md bg-primary-mint text-white font-medium disabled:opacity-50 transition-opacity"
                                >
                                    {saving ? '保存中…' : '保存批注'}
                                </button>
                            </div>
                        </div>
                    )}
                    {annotations.map((annotation) => (
                        <div
                            key={annotation.id}
                            className={cn(
                                'rounded-lg border p-3 bg-bg-container',
                                annotation.status === 'resolved'
                                    ? 'border-border opacity-70'
                                    : 'border-primary-mint/20'
                            )}
                        >
                            <button
                                onClick={() => onJump(annotation)}
                                className="w-full text-left text-[12px] text-text-secondary border-l-2 border-primary-mint/50 pl-2 line-clamp-2 hover:text-primary-mint transition-colors"
                            >
                                {annotation.quote}
                            </button>
                            <p className="mt-2 text-[13px] text-text leading-relaxed whitespace-pre-wrap">{annotation.body}</p>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-text-quaternary">
                                <CircleDot size={10} className={annotation.status === 'open' ? 'text-primary-mint' : 'text-text-quaternary'} />
                                <span className="flex-1">{annotation.status === 'open' ? '未解决' : '已解决'}</span>
                                <button
                                    onClick={() => onToggleStatus(annotation)}
                                    className="hover:text-primary-mint transition-colors"
                                >
                                    {annotation.status === 'open' ? '标记已解决' : '重新打开'}
                                </button>
                                <button
                                    onClick={() => onDelete(annotation)}
                                    className="hover:text-red-500 transition-colors"
                                >
                                    删除
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

const ActivityRow: React.FC<{ label: string; name: string; time: string }> = ({ label, name, time }) => (
    <div className="flex items-center gap-2 text-[11px] leading-5">
        <span className="w-10 shrink-0 text-gray-400 dark:text-gray-500">{label}</span>
        <span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400">{name}</span>
        <span className="shrink-0 text-gray-400 dark:text-gray-500">{time}</span>
    </div>
)

const ToggleSwitch: React.FC<{ on: boolean }> = ({ on }) => (
    <div className={cn(
        'relative w-8 h-[18px] rounded-full transition-colors duration-200 shrink-0',
        on ? 'bg-primary-mint' : 'bg-gray-200 dark:bg-white/20'
    )}>
        <div className={cn(
            'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200',
            on ? 'translate-x-[18px]' : 'translate-x-[2px]'
        )} />
    </div>
)
