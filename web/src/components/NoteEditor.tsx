import React from 'react'
import MDEditor from '@uiw/react-md-editor'
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
    const [showMeta, setShowMeta] = React.useState(!note)
    const [confirmDelete, setConfirmDelete] = React.useState(false)

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
            {/* Toolbar */}
            <div className="min-h-[3.5rem] border-b border-border flex items-center gap-2 px-3 md:px-5 shrink-0 bg-bg-container/80 backdrop-blur-xl flex-wrap py-2"
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <button
                    onClick={onBack}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-text shrink-0"
                >
                    <ArrowLeft size={16} />
                </button>

                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('articleTitle')}
                    className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-text-quaternary tracking-tight"
                />

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setShowMeta((v) => !v)}
                        className={cn(
                            'px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 font-medium',
                            showMeta ? 'bg-primary-mint/12 text-primary-mint' : 'text-text-tertiary hover:bg-fill-secondary hover:text-text-secondary'
                        )}
                    >
                        {t('meta')}
                    </button>
                    <button
                        onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-text"
                        title={mode === 'edit' ? t('preview') : t('edit')}
                    >
                        {mode === 'edit' ? <Eye size={14} /> : <Pencil size={14} />}
                    </button>
                    {note && (
                        confirmDelete ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleDelete}
                                    className="px-2.5 py-1.5 text-xs bg-destructive text-white rounded-lg font-medium transition-all duration-200 hover:bg-destructive/90"
                                >
                                    {t('confirmDelete')}
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="px-2.5 py-1.5 text-xs text-text-tertiary hover:bg-fill-secondary rounded-lg transition-colors"
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-tertiary hover:text-destructive"
                                title={t('delete')}
                            >
                                <Trash2 size={14} />
                            </button>
                        )
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || !title.trim()}
                        className={cn(
                            'flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-xl transition-all duration-200 font-medium',
                            saving || !title.trim()
                                ? 'bg-fill-secondary text-text-quaternary cursor-not-allowed'
                                : 'bg-gradient-to-b from-primary-mint to-emerald-600 text-white hover:opacity-90'
                        )}
                        style={!saving && title.trim() ? { boxShadow: '0 2px 8px rgba(52, 211, 153, 0.25)' } : undefined}
                    >
                        <Save size={12} />
                        {saving ? t('saving') : t('save')}
                    </button>
                </div>
            </div>

            {/* Meta fields (collapsible) */}
            {showMeta && (
                <div className="border-b border-border px-4 md:px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0 bg-fill-secondary/30">
                    <MetaField label={t('author')} value={author} onChange={setAuthor} />
                    <MetaField label={t('date')} value={date} onChange={setDate} type="date" />
                    <MetaField label={t('source')} value={source} onChange={setSource} />
                    <MetaField label={t('tags')} value={tags} onChange={setTags} placeholder={t('tagsPlaceholder')} />
                    <div className="md:col-span-2">
                        <MetaField label={t('summary')} value={summary} onChange={setSummary} />
                    </div>
                </div>
            )}

            {/* Editor / Preview */}
            <div className="flex-1 overflow-hidden" data-color-mode="light">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="flex items-center gap-2 text-sm text-text-tertiary">
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                            <span className="typing-dot" style={{ width: 5, height: 5 }} />
                        </div>
                    </div>
                ) : mode === 'edit' ? (
                    <MDEditor
                        value={content}
                        onChange={(val) => setContent(val ?? '')}
                        height="100%"
                        visibleDragbar={false}
                        preview="edit"
                        className="note-md-editor"
                    />
                ) : (
                    <div className="h-full overflow-y-auto custom-scrollbar p-6">
                        <MDEditor.Markdown source={content} className="markdown-content text-sm leading-relaxed" />
                    </div>
                )}
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
