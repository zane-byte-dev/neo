import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Save, Trash2, Eye, Pencil } from 'lucide-react'
import { notebookRead, notebookUpdate, notebookCreate, notebookDelete } from '../api'
import { cn } from '../lib/utils'
import type { NoteEntry } from '../types'
import { t } from '../i18n'

interface NoteEditorProps {
    note: NoteEntry | null             // null = create new
    notebook?: string                  // target notebook when creating new
    onBack: () => void
    onSaved: (entry: NoteEntry) => void
    onDeleted?: (id: string) => void
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ note, notebook = 'personal', onBack, onSaved, onDeleted }) => {
    const [title, setTitle] = React.useState(note?.title ?? '')
    const [author, setAuthor] = React.useState(note?.author ?? '')
    const [date, setDate] = React.useState(note?.date ?? new Date().toISOString().split('T')[0])
    const [source, setSource] = React.useState(note?.source ?? '')
    const [summary, setSummary] = React.useState(note?.summary ?? '')
    const [tags, setTags] = React.useState(note?.tags ?? '')
    const [content, setContent] = React.useState('')
    const [loading, setLoading] = React.useState(!!note)
    const [saving, setSaving] = React.useState(false)
    const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
    const [showMeta, setShowMeta] = React.useState(false)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const titleRef = React.useRef<HTMLTextAreaElement>(null)
    const contentRef = React.useRef<HTMLTextAreaElement>(null)

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
                if (title.trim()) handleSave()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, content, author, date, source, summary, tags])

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

    const handleSave = async () => {
        if (!title.trim()) return
        setSaving(true)
        try {
            const payload = {
                title: title.trim(),
                author: author.trim() || null,
                date: date.trim() || null,
                source: source.trim() || null,
                summary: summary.trim() || null,
                tags: tags.trim() || null,
                content,
            }
            const result = note
                ? await notebookUpdate(note.id, payload)
                : await notebookCreate(notebook, payload)
            onSaved(result)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!note || !confirmDelete) return
        try {
            await notebookDelete(note.id)
            onDeleted?.(note.id)
        } catch { /* ignore */ }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Minimal toolbar */}
            <div className="h-11 border-b border-border flex items-center gap-1.5 px-3 shrink-0 bg-bg-container/80 backdrop-blur-xl"
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <button
                    onClick={onBack}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-text shrink-0"
                >
                    <ArrowLeft size={15} />
                </button>

                <div className="flex-1" />

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowMeta((v) => !v)}
                        className={cn(
                            'px-2 py-1 text-[11px] rounded-md transition-all duration-200 font-medium',
                            showMeta ? 'bg-primary-mint/12 text-primary-mint' : 'text-text-quaternary hover:bg-fill-secondary hover:text-text-tertiary'
                        )}
                    >
                        {t('meta')}
                    </button>
                    <button
                        onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-quaternary hover:text-text-secondary"
                        title={mode === 'edit' ? t('preview') : t('edit')}
                    >
                        {mode === 'edit' ? <Eye size={13} /> : <Pencil size={13} />}
                    </button>
                    {note && (
                        confirmDelete ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleDelete}
                                    className="px-2 py-1 text-[11px] bg-destructive text-white rounded-md font-medium transition-all duration-200 hover:bg-destructive/90"
                                >
                                    {t('confirmDelete')}
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="px-2 py-1 text-[11px] text-text-tertiary hover:bg-fill-secondary rounded-md transition-colors"
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-quaternary hover:text-destructive"
                                title={t('delete')}
                            >
                                <Trash2 size={13} />
                            </button>
                        )
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || !title.trim()}
                        className={cn(
                            'flex items-center gap-1 px-3 py-1 text-[11px] rounded-lg transition-all duration-200 font-medium ml-0.5',
                            saving || !title.trim()
                                ? 'bg-fill-secondary text-text-quaternary cursor-not-allowed'
                                : 'bg-gradient-to-b from-primary-mint to-emerald-600 text-white hover:opacity-90'
                        )}
                        style={!saving && title.trim() ? { boxShadow: '0 1px 6px rgba(52, 211, 153, 0.25)' } : undefined}
                    >
                        <Save size={11} />
                        {saving ? t('saving') : t('save')}
                    </button>
                </div>
            </div>

            {/* Document body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Title */}
                <div className="px-8 md:px-16 pt-10 pb-2">
                    <textarea
                        ref={titleRef}
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value)
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                        }}
                        placeholder={t('articleTitle')}
                        rows={1}
                        className="w-full bg-transparent text-[1.75rem] font-bold outline-none resize-none leading-snug placeholder:text-text-quaternary text-text overflow-hidden"
                        style={{ minHeight: '2.5rem' }}
                    />
                </div>

                {/* Meta (collapsible) */}
                {showMeta && (
                    <div className="px-8 md:px-16 pb-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-4 bg-fill-secondary/40 rounded-xl border border-border">
                            <MetaField label={t('author')} value={author} onChange={setAuthor} />
                            <MetaField label={t('date')} value={date} onChange={setDate} type="date" />
                            <MetaField label={t('source')} value={source} onChange={setSource} />
                            <MetaField label={t('tags')} value={tags} onChange={setTags} placeholder={t('tagsPlaceholder')} />
                            <div className="md:col-span-2">
                                <MetaField label={t('summary')} value={summary} onChange={setSummary} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Content editor */}
                <div className="px-8 md:px-16 pb-16" style={{ minHeight: '60vh' }}>
                    {loading ? (
                        <div className="flex items-center gap-2 pt-8 text-text-tertiary">
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                        </div>
                    ) : mode === 'edit' ? (
                        <textarea
                            ref={contentRef}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Tab') {
                                    e.preventDefault()
                                    const el = e.currentTarget
                                    const start = el.selectionStart
                                    const end = el.selectionEnd
                                    const next = content.substring(0, start) + '  ' + content.substring(end)
                                    setContent(next)
                                    requestAnimationFrame(() => {
                                        el.selectionStart = el.selectionEnd = start + 2
                                    })
                                }
                            }}
                            placeholder="开始写作…"
                            className="w-full bg-transparent outline-none resize-none text-[15px] leading-relaxed text-text placeholder:text-text-quaternary font-mono"
                            style={{ minHeight: '60vh', fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace" }}
                        />
                    ) : (
                        <div className="markdown-content text-sm leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </div>
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
    <label className="flex items-center gap-2.5 text-xs">
        <span className="text-text-tertiary w-8 shrink-0 font-medium">{label}</span>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-fill-secondary border border-border rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary-mint/30 focus:border-primary-mint/40 transition-all duration-200 placeholder:text-text-quaternary"
        />
    </label>
)
