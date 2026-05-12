import React from 'react'
import { ArrowLeft, Trash2, Check, Loader2, History, MoreHorizontal, Link, Copy, Maximize2, Type, Download } from 'lucide-react'
import { fetchMe, notebookRead, notebookUpdate, notebookCreate, notebookDelete } from '../api'
import { cn } from '../lib/utils'
import type { NoteEntry } from '../types'
import { t } from '../i18n'
import { NovelEditor } from './NovelEditor'
import { HistoryDrawer } from './notebook/HistoryDrawer'

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
    const [summary] = React.useState(note?.summary ?? '')
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
    const titleRef = React.useRef<HTMLTextAreaElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const autoSaveTimerRef = React.useRef<number | null>(null)
    const isDirtyRef = React.useRef(false)
    // Keep latest field values accessible in auto-save callback without stale closures
    const fieldsRef = React.useRef({ title, author, date, source, summary, tags, content })
    React.useEffect(() => {
        fieldsRef.current = { title, author, date, source, summary, tags, content }
    })

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

    const creatorName = author.trim() || currentDisplayName || '未知'
    const editorName = currentDisplayName || creatorName
    const createdTime = note?.createdAt ?? date
    const updatedTime = note?.updatedAt ?? createdTime

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#191919]">
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

                    {/* Content — Novel rich-text editor */}
                    {loading ? (
                        <div className="flex items-center gap-2 text-gray-300">
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                        </div>
                    ) : (
                        <NovelEditor
                            key={note?.id ?? 'new'}
                            initialContent={content}
                            placeholder="开始写作… 输入 / 插入块"
                            onChange={(md) => {
                                setContent(md)
                                scheduleAutoSave()
                            }}
                            className="pb-20"
                        />
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
