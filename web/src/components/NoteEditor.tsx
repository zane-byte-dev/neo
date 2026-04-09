import React from 'react'
import MDEditor from '@uiw/react-md-editor'
import { ArrowLeft, Save, Trash2, Eye, Pencil } from 'lucide-react'
import { notebookRead, notebookUpdate, notebookCreate, notebookDelete } from '../api'
import { cn } from '../lib/utils'
import type { NoteEntry } from '../types'

interface NoteEditorProps {
    note: NoteEntry | null             // null = create new
    onBack: () => void
    onSaved: (entry: NoteEntry) => void
    onDeleted?: (id: number) => void
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ note, onBack, onSaved, onDeleted }) => {
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
                : await notebookCreate(payload)
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
            <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <button
                    onClick={onBack}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors text-text-secondary"
                >
                    <ArrowLeft size={15} />
                </button>

                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="文章标题…"
                    className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-text-quaternary"
                />

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setShowMeta((v) => !v)}
                        className={cn(
                            'px-2 py-1 text-xs rounded-md transition-colors',
                            showMeta ? 'bg-primary-mint/15 text-primary-mint' : 'text-text-tertiary hover:bg-fill-secondary'
                        )}
                    >
                        Meta
                    </button>
                    <button
                        onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors text-text-secondary"
                        title={mode === 'edit' ? '预览' : '编辑'}
                    >
                        {mode === 'edit' ? <Eye size={14} /> : <Pencil size={14} />}
                    </button>
                    {note && (
                        confirmDelete ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleDelete}
                                    className="px-2 py-1 text-xs bg-destructive text-white rounded-md"
                                >
                                    确认删除
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="px-2 py-1 text-xs text-text-tertiary hover:bg-fill-secondary rounded-md"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors text-text-tertiary hover:text-destructive"
                                title="删除"
                            >
                                <Trash2 size={14} />
                            </button>
                        )
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || !title.trim()}
                        className={cn(
                            'flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors font-medium',
                            saving || !title.trim()
                                ? 'bg-fill-secondary text-text-quaternary cursor-not-allowed'
                                : 'bg-primary-mint text-white hover:bg-primary-mint/90'
                        )}
                    >
                        <Save size={12} />
                        {saving ? '保存中…' : '保存'}
                    </button>
                </div>
            </div>

            {/* Meta fields (collapsible) */}
            {showMeta && (
                <div className="border-b border-border px-4 py-3 grid grid-cols-2 gap-2 shrink-0">
                    <MetaField label="作者" value={author} onChange={setAuthor} />
                    <MetaField label="日期" value={date} onChange={setDate} type="date" />
                    <MetaField label="来源" value={source} onChange={setSource} />
                    <MetaField label="标签" value={tags} onChange={setTags} placeholder='JSON 如 ["标签1","标签2"]' />
                    <div className="col-span-2">
                        <MetaField label="摘要" value={summary} onChange={setSummary} />
                    </div>
                </div>
            )}

            {/* Editor / Preview */}
            <div className="flex-1 overflow-hidden" data-color-mode="light">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-sm text-text-tertiary italic">Loading…</div>
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
                    <div className="h-full overflow-y-auto custom-scrollbar p-5">
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
    <label className="flex items-center gap-2 text-xs">
        <span className="text-text-tertiary w-8 shrink-0">{label}</span>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-fill-secondary border border-border rounded-md px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary-mint"
        />
    </label>
)
