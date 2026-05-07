import React from 'react'
import { ArrowLeft, Trash2, Check, Loader2 } from 'lucide-react'
import { notebookRead, notebookUpdate, notebookCreate, notebookDelete } from '../api'
import { cn } from '../lib/utils'
import type { NoteEntry } from '../types'
import { t } from '../i18n'
import { NovelEditor } from './NovelEditor'

interface NoteEditorProps {
    note: NoteEntry | null             // null = create new
    notebook?: string                  // target notebook when creating new
    onBack: () => void
    onSaved: (entry: NoteEntry) => void
    onDeleted?: (id: string) => void
    /**
     * When true: enables Notion-style auto-save (debounce 1.5s after last change).
     * Hides the manual Save button; shows a subtle status indicator instead.
     * Back button is also hidden (parent controls navigation).
     */
    autoSave?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export const NoteEditor: React.FC<NoteEditorProps> = ({ note, notebook = 'personal', onBack, onSaved, onDeleted, autoSave = false }) => {
    const [title, setTitle] = React.useState(note?.title ?? '')
    const [author, setAuthor] = React.useState(note?.author ?? '')
    const [date, setDate] = React.useState(note?.date ?? new Date().toISOString().split('T')[0])
    const [source, setSource] = React.useState(note?.source ?? '')
    const [summary, setSummary] = React.useState(note?.summary ?? '')
    const [tags, setTags] = React.useState(note?.tags ?? '')
    const [content, setContent] = React.useState('')
    const [loading, setLoading] = React.useState(!!note)
    const [saving, setSaving] = React.useState(false)
    const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle')
    const [showMeta, setShowMeta] = React.useState(false)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const titleRef = React.useRef<HTMLTextAreaElement>(null)
    const autoSaveTimerRef = React.useRef<number | null>(null)
    const isDirtyRef = React.useRef(false)
    // Keep latest field values accessible in auto-save callback without stale closures
    const fieldsRef = React.useRef({ title, author, date, source, summary, tags, content })
    React.useEffect(() => {
        fieldsRef.current = { title, author, date, source, summary, tags, content }
    })

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
                    <button
                        onClick={() => setShowMeta((v) => !v)}
                        className={cn(
                            'px-2 py-1 text-[11px] rounded-md transition-colors font-medium',
                            showMeta
                                ? 'text-primary-mint bg-primary-mint/10'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'
                        )}
                    >
                        {t('meta')}
                    </button>
                    {note && (
                        confirmDelete ? (
                            <div className="flex items-center gap-1 ml-1">
                                <button
                                    onClick={handleDelete}
                                    className="px-2 py-1 text-[11px] bg-red-500 text-white rounded-md font-medium hover:bg-red-600 transition-colors"
                                >
                                    {t('confirmDelete')}
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                                title={t('delete')}
                            >
                                <Trash2 size={13} />
                            </button>
                        )
                    )}
                    {!autoSave && (
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || !title.trim()}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md transition-colors font-medium ml-1',
                                saving || !title.trim()
                                    ? 'bg-gray-100 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                                    : 'bg-[#2ecc71] hover:bg-[#27ae60] text-white'
                            )}
                        >
                            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                            {saving ? t('saving') : t('save')}
                        </button>
                    )}
                </div>
            </div>

            {/* ── Document body: single full-width scroll container ── */}
            <div className="flex-1 overflow-y-auto">
                {/* Centered content column — consistent with Notion's ~46rem prose width */}
                <div className="w-full max-w-[46rem] mx-auto px-16 pt-14 pb-20">

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
                        className="w-full bg-transparent text-[2rem] font-bold outline-none resize-none leading-[1.3] mb-1 placeholder:text-gray-200 dark:placeholder:text-white/15 text-[#1a1a1a] dark:text-[#e8e8e8] overflow-hidden"
                        style={{ minHeight: '2.6rem' }}
                    />

                    {/* Meta (collapsible) */}
                    {showMeta && (
                        <div className="mb-6 mt-2 grid grid-cols-2 gap-x-6 gap-y-2.5 py-4 border-y border-gray-100 dark:border-white/8">
                            <MetaField label={t('author')} value={author} onChange={(v) => { setAuthor(v); scheduleAutoSave() }} />
                            <MetaField label={t('date')} value={date} onChange={(v) => { setDate(v); scheduleAutoSave() }} type="date" />
                            <MetaField label={t('source')} value={source} onChange={(v) => { setSource(v); scheduleAutoSave() }} />
                            <MetaField label={t('tags')} value={tags} onChange={(v) => { setTags(v); scheduleAutoSave() }} placeholder={t('tagsPlaceholder')} />
                            <div className="col-span-2">
                                <MetaField label={t('summary')} value={summary} onChange={(v) => { setSummary(v); scheduleAutoSave() }} />
                            </div>
                        </div>
                    )}

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
        </div>
    )
}
const MetaField: React.FC<{
    label: string
    value: string
    onChange: (v: string) => void
    type?: string
    placeholder?: string
}> = ({ label, value, onChange, type = 'text', placeholder }) => (
    <label className="flex items-center gap-2 text-[12px]">
        <span className="text-gray-400 dark:text-gray-500 w-10 shrink-0">{label}</span>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-b border-gray-200 dark:border-white/10 py-1 text-[13px] text-[#374151] dark:text-[#d1d5db] outline-none focus:border-gray-400 dark:focus:border-white/30 transition-colors placeholder:text-gray-300 dark:placeholder:text-white/20"
        />
    </label>
)
