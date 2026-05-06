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
        <div className="flex flex-col h-full bg-white dark:bg-[#191919]">
            {/* Slim action bar — scoped to content width */}
            <div className="shrink-0 flex items-center justify-between px-4 h-10 border-b border-gray-100 dark:border-white/8">
                <button
                    onClick={onBack}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                >
                    <ArrowLeft size={14} />
                </button>

                <div className="flex items-center gap-0.5">
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
                    <button
                        onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                        title={mode === 'edit' ? t('preview') : t('edit')}
                    >
                        {mode === 'edit' ? <Eye size={13} /> : <Pencil size={13} />}
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
                    <button
                        onClick={handleSave}
                        disabled={saving || !title.trim()}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md transition-colors font-medium ml-1',
                            saving || !title.trim()
                                ? 'bg-gray-100 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                                : 'bg-[#2ecc71] hover:bg-[#27ae60] text-white'
                        )}
                    >
                        <Save size={11} />
                        {saving ? t('saving') : t('save')}
                    </button>
                </div>
            </div>

            {/* Document body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="max-w-[720px] mx-auto px-14 pt-12 pb-16">
                    {/* Title */}
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
                        className="w-full bg-transparent text-[28px] font-bold outline-none resize-none leading-tight mb-4 placeholder:text-gray-300 dark:placeholder:text-white/20 text-[#1a1a1a] dark:text-[#e8e8e8] overflow-hidden"
                        style={{ minHeight: '2.25rem' }}
                    />

                    {/* Meta (collapsible) */}
                    {showMeta && (
                        <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2.5 py-4 border-y border-gray-100 dark:border-white/8">
                            <MetaField label={t('author')} value={author} onChange={setAuthor} />
                            <MetaField label={t('date')} value={date} onChange={setDate} type="date" />
                            <MetaField label={t('source')} value={source} onChange={setSource} />
                            <MetaField label={t('tags')} value={tags} onChange={setTags} placeholder={t('tagsPlaceholder')} />
                            <div className="col-span-2">
                                <MetaField label={t('summary')} value={summary} onChange={setSummary} />
                            </div>
                        </div>
                    )}

                    {/* Content editor */}
                    {loading ? (
                        <div className="flex items-center gap-2 pt-4 text-gray-300">
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
                            className="w-full bg-transparent outline-none resize-none text-[15px] leading-[1.8] text-[#374151] dark:text-[#d1d5db] placeholder:text-gray-300 dark:placeholder:text-white/20"
                            style={{ minHeight: '60vh' }}
                        />
                    ) : (
                        <div className="markdown-content text-[15px] leading-[1.8] text-[#374151] dark:text-[#d1d5db]">
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
