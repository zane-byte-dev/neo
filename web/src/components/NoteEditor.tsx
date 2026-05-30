import React from 'react'
import { ArrowLeft, Trash2, Check, Loader2, History, MoreHorizontal, Link, Copy, Maximize2, Type, Download, Layers, Languages, Sparkles, RefreshCw, EyeOff, MessageSquarePlus, MessageSquare, CircleDot, Volume2 } from 'lucide-react'
import { fetchMe, notebookRead, notebookUpdate, notebookCreate, notebookDelete, notebookListAnnotations, notebookSaveAnnotation, notebookUpdateAnnotation, notebookDeleteAnnotation, notebookGenerateArtifact } from '../api'
import { cn } from '../lib/utils'
import type { Artifact, NoteEntry, NotebookAnnotation, NotebookAnnotationAnchor } from '../types'
import { t } from '../i18n'
import { NovelEditor, type GeneratedResourceBlockData, type GeneratedResourceType, type NovelEditorHandle } from './NovelEditor'
import { HistoryDrawer } from './notebook/HistoryDrawer'
import { DocDiffModal } from './notebook/DocDiffModal'
import { ResourcesPanel } from './notebook/ResourcesPanel'
import { ArtifactViewer } from './notebook/studio/ArtifactViewer'
import { EDIT_ACTIONS, INSIGHT_ACTIONS, type DocEditAction } from './notebook/docActions'
import { getArtifactMarkdown, getMindMapMarkdown } from './notebook/artifact-utils'
import { useAppStore } from '../stores/useAppStore'
import { toast } from './Toast'

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

function sourceIdFromArticleId(articleId: string | null | undefined): string | null {
    if (!articleId) return null
    const last = articleId.split('/').pop()
    if (!last) return null
    return last.replace(/\.md$/, '')
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
    const [viewingArticleArtifact, setViewingArticleArtifact] = React.useState<Artifact | null>(null)
    const [audioGenerating, setAudioGenerating] = React.useState(false)
    // Diff modal (AI edit actions from more menu)
    const [diffAction, setDiffAction] = React.useState<{ action: DocEditAction; content: string } | null>(null)
    const [annotations, setAnnotations] = React.useState<NotebookAnnotation[]>([])
    const [annotationsExpanded, setAnnotationsExpanded] = React.useState(false)
    const [annotationDraft, setAnnotationDraft] = React.useState<AnnotationDraft | null>(null)
    const [annotationBody, setAnnotationBody] = React.useState('')
    const [annotationSaving, setAnnotationSaving] = React.useState(false)
    const [hoveredAnnotationId, setHoveredAnnotationId] = React.useState<string | null>(null)
    const [focusRange, setFocusRange] = React.useState<{ startOffset: number; endOffset: number; requestId: number } | null>(null)
    const focusRequestIdRef = React.useRef(0)
    const annotationHoverTimerRef = React.useRef<number | null>(null)
    // Inline summary state
    type SummaryState = 'empty' | 'generating' | 'done'
    const [summaryState, setSummaryState] = React.useState<SummaryState>(() => (note?.summary ?? '').trim() ? 'done' : 'empty')
    const [summaryText, setSummaryText] = React.useState(note?.summary ?? '')
    const [summaryCollapsed, setSummaryCollapsed] = React.useState(() =>
        note ? localStorage.getItem(`neo:editor:summaryCollapsed:${note.id}`) === '1' : false
    )
    const titleRef = React.useRef<HTMLTextAreaElement>(null)
    const editorRef = React.useRef<NovelEditorHandle>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const autoSaveTimerRef = React.useRef<number | null>(null)
    const isDirtyRef = React.useRef(false)
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
                if (fieldsRef.current.title.trim()) void handleSave(true)
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

    // Reset dirty flag on note change (remount via key=)
    React.useEffect(() => {
        isDirtyRef.current = false
        setSaveStatus('idle')
    }, [note?.id])

    // Cleanup auto-save timer on unmount
    React.useEffect(() => () => {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }, [])

    const handleSave = React.useCallback(async (showFeedback = !autoSave) => {
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
            if (showFeedback) toast.success(t('noteSaved'))
            // Fade "saved" indicator after 2.5s
            setTimeout(() => setSaveStatus('idle'), 2500)
        } catch {
            setSaveStatus('error')
            if (showFeedback) toast.error(t('noteSaveFailed'))
        } finally {
            setSaving(false)
        }
    }, [autoSave, note, notebook, onSaved])

    // Schedule auto-save after field changes
    const scheduleAutoSave = React.useCallback(() => {
        if (!autoSave || !note) return          // only auto-save existing notes
        isDirtyRef.current = true
        setSaveStatus('idle')
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = window.setTimeout(() => void handleSave(false), 1500)
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

    const clearAnnotationHoverTimer = React.useCallback(() => {
        if (annotationHoverTimerRef.current) {
            window.clearTimeout(annotationHoverTimerRef.current)
            annotationHoverTimerRef.current = null
        }
    }, [])

    const scheduleAnnotationHoverClear = React.useCallback(() => {
        clearAnnotationHoverTimer()
        annotationHoverTimerRef.current = window.setTimeout(() => setHoveredAnnotationId(null), 520)
    }, [clearAnnotationHoverTimer])

    const handleAnnotationHoverChange = React.useCallback((annotation: NotebookAnnotation | null) => {
        if (annotation) {
            clearAnnotationHoverTimer()
            setHoveredAnnotationId(annotation.id)
            return
        }
        scheduleAnnotationHoverClear()
    }, [clearAnnotationHoverTimer, scheduleAnnotationHoverClear])

    const handleCancelAnnotationDraft = React.useCallback(() => {
        if (annotationDraft) editorRef.current?.removeAnnotationMark(annotationDraft)
        setAnnotationDraft(null)
        setAnnotationBody('')
    }, [annotationDraft])

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
            clearAnnotationHoverTimer()
            setHoveredAnnotationId(saved.id)
            setAnnotationDraft(null)
            setAnnotationBody('')
        } catch {
            // keep draft open for retry
        } finally {
            setAnnotationSaving(false)
        }
    }, [annotationBody, annotationDraft, clearAnnotationHoverTimer, currentDisplayName, note, notebook])

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
            editorRef.current?.removeAnnotationMark(annotation)
            setAnnotations((items) => items.filter((item) => item.id !== annotation.id))
        } catch { /* ignore */ }
    }, [note, notebook])

    const handleJumpToAnnotation = React.useCallback((annotation: NotebookAnnotation) => {
        const startOffset = annotation.anchor.startOffset
        const endOffset = annotation.anchor.endOffset
        if (typeof startOffset !== 'number' || typeof endOffset !== 'number') return
        clearAnnotationHoverTimer()
        setHoveredAnnotationId(annotation.id)
        focusRequestIdRef.current += 1
        setFocusRange({ startOffset, endOffset, requestId: focusRequestIdRef.current })
    }, [clearAnnotationHoverTimer])

    const articleSourceId = React.useMemo(() => sourceIdFromArticleId(note?.id), [note?.id])
    const articleNotebook = note?.notebook ?? notebook
    const hoveredAnnotation = React.useMemo(
        () => annotations.find((annotation) => annotation.id === hoveredAnnotationId) ?? null,
        [annotations, hoveredAnnotationId],
    )

    React.useEffect(() => {
        if (hoveredAnnotationId && !annotations.some((annotation) => annotation.id === hoveredAnnotationId)) {
            setHoveredAnnotationId(null)
        }
    }, [annotations, hoveredAnnotationId])

    React.useEffect(() => () => clearAnnotationHoverTimer(), [clearAnnotationHoverTimer])

    const handleGenerateArticleAudio = React.useCallback(async () => {
        if (!note || !articleSourceId || audioGenerating) return
        setAudioGenerating(true)
        try {
            const artifact = await notebookGenerateArtifact({
                notebook: articleNotebook,
                type: 'audio',
                sourceIds: [articleSourceId],
                primaryArticleId: note.id,
                audioMode: 'single',
                customPrompt: '请保持忠实于当前文章内容，适合直接转语音播放，不扩展来源外事实。',
            })
            setResourcesOpen(false)
            setViewingArticleArtifact(artifact)
        } catch {
            // keep the toolbar quiet; the user can retry from the same icon
        } finally {
            setAudioGenerating(false)
        }
    }, [articleNotebook, articleSourceId, audioGenerating, note])

    const handleGenerateInlineResource = React.useCallback(async (type: GeneratedResourceType): Promise<GeneratedResourceBlockData | null> => {
        if (!note || !articleSourceId) return null
        const articleTitle = fieldsRef.current.title.trim() || note.title || ''
        const artifactLabel = type === 'report' ? '报告' : '思维导图'
        const artifact = await notebookGenerateArtifact({
            notebook: articleNotebook,
            type,
            sourceIds: [articleSourceId],
            primaryArticleId: note.id,
            topic: articleTitle || artifactLabel,
            title: articleTitle ? `${articleTitle} · ${artifactLabel}` : undefined,
            customPrompt: type === 'report' ? '请生成可直接插入文章正文的结构化报告，保留清晰小标题和要点。' : undefined,
        })
        return {
            type,
            title: artifact.title,
            body: type === 'mindmap' ? getMindMapMarkdown(artifact) : getArtifactMarkdown(artifact),
        }
    }, [articleNotebook, articleSourceId, note])

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
                            {saveStatus === 'saving' ? t('saving') : saveStatus === 'saved' ? t('saved') : saveStatus === 'error' ? t('saveFailed') : ''}
                        </span>
                    )}
                </div>

                {/* Right: action buttons */}
                <div className="shrink-0 flex items-center gap-0.5">
                    {!autoSave && (
                        <button
                            onClick={() => void handleSave(true)}
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
                    {note && articleSourceId && (
                        <button
                            onClick={() => void handleGenerateArticleAudio()}
                            disabled={audioGenerating}
                            className={cn(
                                'w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:cursor-wait',
                                audioGenerating
                                    ? 'bg-primary-mint/10 text-primary-mint'
                                    : 'text-gray-400 hover:text-primary-mint hover:bg-primary-mint/10'
                            )}
                            title="生成语音朗读"
                        >
                            {audioGenerating ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
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
                <div className={cn(
                    'w-full mx-auto pt-14 pb-20',
                    fullWidth ? 'px-6 sm:px-8 lg:px-12' : 'max-w-[82rem] px-6 sm:px-8 lg:px-10 xl:px-12',
                )}>
                    <div className={cn(
                        'flex flex-col gap-6 lg:flex-row lg:items-start',
                        note && !fullWidth && 'lg:justify-center',
                        smallText ? 'text-sm' : '',
                    )}>
                        <div className={cn(
                            'min-w-0 flex-1',
                            note
                                ? (fullWidth ? 'lg:max-w-none' : 'lg:max-w-[46rem]')
                                : (fullWidth ? 'max-w-none' : 'mx-auto max-w-[46rem]'),
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
                            {note && summaryState === 'done' && summaryCollapsed && (
                                <button
                                    onClick={handleShowSummary}
                                    className="mb-4 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-text-quaternary hover:bg-fill-secondary/60 hover:text-primary-mint transition-colors"
                                >
                                    <Sparkles size={12} />
                                    摘要
                                </button>
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
                                        ref={editorRef}
                                        key={note?.id ?? 'new'}
                                        initialContent={content}
                                        placeholder="开始写作… 输入 / 插入块"
                                        onChange={(md) => {
                                            setContent(md)
                                            scheduleAutoSave()
                                        }}
                                        onAnnotateSelection={note ? handleAnnotateSelection : undefined}
                                        annotations={annotations}
                                        onAnnotationHoverChange={note ? handleAnnotationHoverChange : undefined}
                                        onGenerateInlineResource={note && articleSourceId ? handleGenerateInlineResource : undefined}
                                        focusRange={focusRange}
                                        className="pb-8"
                                    />
                                </>
                            )}
                        </div>

                        {note && (
                            <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-[320px] lg:basis-[320px]">
                                <ArticleAnnotationsRail
                                    annotations={annotations}
                                    expanded={annotationsExpanded}
                                    draft={annotationDraft}
                                    body={annotationBody}
                                    saving={annotationSaving}
                                    hoveredAnnotation={hoveredAnnotation}
                                    onHoverCardMouseEnter={clearAnnotationHoverTimer}
                                    onHoverCardMouseLeave={scheduleAnnotationHoverClear}
                                    onToggleExpanded={() => setAnnotationsExpanded((v) => !v)}
                                    onBodyChange={setAnnotationBody}
                                    onSave={() => void handleSaveAnnotation()}
                                    onCancelDraft={handleCancelAnnotationDraft}
                                    onJump={handleJumpToAnnotation}
                                    onToggleStatus={(annotation) => void handleToggleAnnotationStatus(annotation)}
                                    onDelete={(annotation) => void handleDeleteAnnotation(annotation)}
                                />
                            </aside>
                        )}
                    </div>
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
                        />
                    </div>
                </>
            )}
        </div>
    )
}

const ArticleAnnotationsRail: React.FC<{
    annotations: NotebookAnnotation[]
    expanded: boolean
    draft: AnnotationDraft | null
    body: string
    saving: boolean
    hoveredAnnotation: NotebookAnnotation | null
    onHoverCardMouseEnter: () => void
    onHoverCardMouseLeave: () => void
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
    hoveredAnnotation,
    onHoverCardMouseEnter,
    onHoverCardMouseLeave,
    onToggleExpanded,
    onBodyChange,
    onSave,
    onCancelDraft,
    onJump,
    onToggleStatus,
    onDelete,
}) => {
    type AnnotationFilter = 'all' | 'open' | 'resolved' | 'highlight' | 'paragraph'
    const openCount = annotations.filter((annotation) => annotation.status === 'open').length
    const resolvedCount = annotations.length - openCount
    const [filter, setFilter] = React.useState<AnnotationFilter>('all')
    const sortedAnnotations = React.useMemo(() => [...annotations].sort((a, b) => {
        const aOffset = typeof a.anchor.startOffset === 'number' ? a.anchor.startOffset : Number.MAX_SAFE_INTEGER
        const bOffset = typeof b.anchor.startOffset === 'number' ? b.anchor.startOffset : Number.MAX_SAFE_INTEGER
        if (aOffset !== bOffset) return aOffset - bOffset
        return a.createdAt - b.createdAt
    }), [annotations])
    const visibleAnnotations = sortedAnnotations.filter((annotation) => {
        if (filter === 'all') return true
        if (filter === 'open' || filter === 'resolved') return annotation.status === filter
        return annotation.kind === filter
    })
    const filterOptions: Array<{ id: AnnotationFilter; label: string; count: number }> = [
        { id: 'all', label: '全部', count: annotations.length },
        { id: 'open', label: t('annotationStatusOpen'), count: openCount },
        { id: 'resolved', label: t('annotationStatusResolved'), count: resolvedCount },
        { id: 'highlight', label: '划线', count: annotations.filter((annotation) => annotation.kind === 'highlight').length },
        { id: 'paragraph', label: '段落', count: annotations.filter((annotation) => annotation.kind === 'paragraph').length },
    ]

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-border/70 bg-bg-container/90 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-text-secondary">
                    <MessageSquare size={13} className="text-primary-mint shrink-0" />
                    {t('annotationPanelTitle')}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-text-quaternary">
                    {annotations.length === 0 ? t('annotationRailEmpty') : t('annotationRailHoverHint')}
                </p>
            </div>

            {draft && (
                <div className="rounded-xl border border-border bg-bg-container shadow-sm px-3.5 py-3.5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-text">
                        <MessageSquarePlus size={13} className="text-primary-mint shrink-0" />
                        {t('annotationNew')}
                    </div>
                    <blockquote className="mt-2 text-[12px] text-text-tertiary border-l-2 border-primary-mint/50 pl-2 line-clamp-2">
                        {draft.quote}
                    </blockquote>
                    <textarea
                        value={body}
                        onChange={(e) => onBodyChange(e.target.value)}
                        placeholder={t('annotationPlaceholder')}
                        rows={3}
                        className="mt-2 w-full resize-none rounded-md border border-border bg-bg-container px-2.5 py-2 text-[13px] text-text outline-none focus:border-primary-mint"
                        autoFocus
                    />
                    <div className="mt-2 flex justify-end gap-2">
                        <button
                            onClick={onCancelDraft}
                            className="px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-fill rounded-md transition-colors"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={onSave}
                            disabled={saving || !body.trim()}
                            className="px-3 py-1.5 text-[12px] rounded-md bg-primary-mint text-white font-medium disabled:opacity-50 transition-opacity"
                        >
                            {saving ? t('saving') : t('save')}
                        </button>
                    </div>
                </div>
            )}

            {hoveredAnnotation && (
                <div
                    className="rounded-xl border border-primary-mint/20 bg-primary-mint/5 px-3.5 py-3.5 shadow-sm"
                    onMouseEnter={onHoverCardMouseEnter}
                    onMouseLeave={onHoverCardMouseLeave}
                >
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-text">
                        <CircleDot size={12} className={hoveredAnnotation.status === 'open' ? 'text-primary-mint' : 'text-text-quaternary'} />
                        {t('annotationHoverCardTitle')}
                        <span className="ml-auto text-[11px] text-text-quaternary">
                            {hoveredAnnotation.status === 'open' ? t('annotationStatusOpen') : t('annotationStatusResolved')}
                        </span>
                    </div>
                    <blockquote className="mt-2 text-[12px] text-text-tertiary border-l-2 border-primary-mint/50 pl-2 line-clamp-3">
                        {hoveredAnnotation.quote}
                    </blockquote>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                        {hoveredAnnotation.body}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-quaternary">
                        <span>{hoveredAnnotation.kind === 'paragraph' ? '段落批注' : '划线批注'}</span>
                        {hoveredAnnotation.author && <span>{hoveredAnnotation.author}</span>}
                        <span className="flex-1" />
                        <button onClick={() => onJump(hoveredAnnotation)} className="hover:text-primary-mint transition-colors">
                            定位
                        </button>
                        <button onClick={() => onToggleStatus(hoveredAnnotation)} className="hover:text-primary-mint transition-colors">
                            {hoveredAnnotation.status === 'open' ? t('annotationResolve') : t('annotationReopen')}
                        </button>
                        <button onClick={() => onDelete(hoveredAnnotation)} className="hover:text-red-500 transition-colors">
                            {t('delete')}
                        </button>
                    </div>
                </div>
            )}

            {annotations.length > 0 && (
                <div className="space-y-2 text-[12px] text-text-tertiary">
                    <button
                        onClick={onToggleExpanded}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg-container px-2.5 hover:border-primary-mint/35 hover:text-primary-mint transition-colors"
                    >
                        <MessageSquare size={12} className="text-primary-mint" />
                        {t('annotationCount', { count: annotations.length })}
                        {openCount > 0 && <span className="text-[11px] text-text-quaternary">{t('annotationOpenCount', { count: openCount })}</span>}
                    </button>
                    {expanded && (
                        <div className="rounded-xl border border-border bg-bg-container shadow-sm">
                            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-3 py-2">
                                {filterOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        onClick={() => setFilter(option.id)}
                                        className={cn(
                                            'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors',
                                            filter === option.id
                                                ? 'bg-primary-mint/12 text-primary-mint'
                                                : 'text-text-tertiary hover:bg-fill hover:text-text-secondary'
                                        )}
                                    >
                                        {option.label}
                                        <span className="text-[10px] text-text-quaternary">{option.count}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="max-h-72 overflow-y-auto custom-scrollbar">
                                {visibleAnnotations.length === 0 ? (
                                    <div className="px-3 py-5 text-center text-[12px] text-text-quaternary">当前筛选下暂无批注</div>
                                ) : visibleAnnotations.map((annotation, index) => (
                                    <div key={annotation.id} className="border-b border-border/60 px-3 py-3 last:border-b-0">
                                        <div className={cn(
                                            'flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                                            hoveredAnnotation?.id === annotation.id
                                                ? 'border-primary-mint/25 bg-primary-mint/6'
                                                : 'border-transparent bg-transparent',
                                        )}>
                                            <button
                                                onClick={() => onJump(annotation)}
                                                className={cn(
                                                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition-colors',
                                                    annotation.status === 'resolved'
                                                        ? 'border-border text-text-quaternary hover:border-primary-mint/40 hover:text-primary-mint'
                                                        : 'border-primary-mint/30 bg-primary-mint/8 text-primary-mint'
                                                )}
                                                title="跳转到正文位置"
                                            >
                                                {index + 1}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <button
                                                    onClick={() => onJump(annotation)}
                                                    className={cn(
                                                        'block w-full text-left text-[12px] leading-relaxed underline underline-offset-4 transition-colors',
                                                        annotation.status === 'resolved'
                                                            ? 'text-text-quaternary decoration-text-quaternary/40 hover:text-primary-mint'
                                                            : 'text-text-secondary decoration-primary-mint/70 hover:text-primary-mint'
                                                    )}
                                                >
                                                    <span className="line-clamp-2">{annotation.quote}</span>
                                                </button>
                                                <p className="mt-1.5 text-[13px] leading-relaxed text-text line-clamp-2">{annotation.body}</p>
                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-quaternary">
                                                    <span className="inline-flex items-center gap-1">
                                                        <CircleDot size={10} className={annotation.status === 'open' ? 'text-primary-mint' : 'text-text-quaternary'} />
                                                        {annotation.status === 'open' ? t('annotationStatusOpen') : t('annotationStatusResolved')}
                                                    </span>
                                                    <span>{annotation.kind === 'paragraph' ? '段落批注' : '划线批注'}</span>
                                                    {annotation.author && <span>{annotation.author}</span>}
                                                    <span className="flex-1" />
                                                    <button onClick={() => onToggleStatus(annotation)} className="hover:text-primary-mint transition-colors">
                                                        {annotation.status === 'open' ? t('annotationResolve') : t('annotationReopen')}
                                                    </button>
                                                    <button onClick={() => onDelete(annotation)} className="hover:text-red-500 transition-colors">
                                                        {t('delete')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
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
