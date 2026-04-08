import React from 'react'
import { Plus, Trash2, RefreshCw, FileText } from 'lucide-react'
import { cn } from '../lib/utils'
import { noteList, noteCreate, noteDelete } from '../api'
import type { InboxNote } from '../types'

// ── Note card ─────────────────────────────────────────────────────────────────

const NoteCard: React.FC<{
    note: InboxNote
    onDelete: (id: number) => void
}> = ({ note, onDelete }) => (
    <div className="group flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-fill-secondary transition-colors">
        <div className="flex-1 min-w-0">
            <p className="text-sm text-text leading-relaxed whitespace-pre-wrap break-words">{note.content}</p>
            <span className="text-xs text-text-quaternary mt-1 block">{note.time}</span>
        </div>
        <button
            onClick={() => onDelete(note.id)}
            className="shrink-0 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-fill rounded-lg text-text-tertiary hover:text-destructive transition-all mt-0.5"
            title="Delete"
        >
            <Trash2 size={13} />
        </button>
    </div>
)

// ── Capture input ─────────────────────────────────────────────────────────────

const CaptureForm: React.FC<{ onCapture: (content: string) => Promise<void> }> = ({ onCapture }) => {
    const [value, setValue] = React.useState('')
    const [loading, setLoading] = React.useState(false)
    const textRef = React.useRef<HTMLTextAreaElement>(null)

    const submit = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setLoading(true)
        try {
            await onCapture(trimmed)
            setValue('')
            textRef.current?.focus()
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }

    return (
        <div className="p-3 border-b border-border bg-bg-container shrink-0">
            <textarea
                ref={textRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Capture a note… (Enter to save, Shift+Enter for newline)"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-fill-secondary border border-border rounded-lg outline-none focus:border-primary-mint/60 focus:bg-bg-container text-text placeholder:text-text-quaternary transition-colors resize-none"
            />
            <div className="flex justify-end mt-2">
                <button
                    onClick={submit}
                    disabled={!value.trim() || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-mint/20 hover:bg-primary-mint/30 border border-primary-mint/40 rounded-lg text-sm text-text disabled:opacity-40 transition-colors"
                >
                    <Plus size={14} />
                    Capture
                </button>
            </div>
        </div>
    )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export const NotePanel: React.FC = () => {
    const [notes, setNotes] = React.useState<InboxNote[]>([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const load = React.useCallback(() => {
        setLoading(true)
        setError(null)
        noteList()
            .then(setNotes)
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false))
    }, [])

    React.useEffect(() => { load() }, [load])

    const handleCapture = async (content: string) => {
        const note = await noteCreate(content)
        setNotes((prev) => [note, ...prev])
    }

    const handleDelete = async (id: number) => {
        setNotes((prev) => prev.filter((n) => n.id !== id))
        await noteDelete(id).catch(() => load())
    }

    // Group notes by date
    const grouped = React.useMemo(() => {
        const map = new Map<string, InboxNote[]>()
        for (const note of notes) {
            const list = map.get(note.date) ?? []
            list.push(note)
            map.set(note.date, list)
        }
        return map
    }, [notes])

    const dates = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a))

    return (
        <div className="flex flex-col h-full bg-bg-layout">
            {/* Header */}
            <div className="h-12 border-b border-border bg-bg-container flex items-center justify-between px-4 shrink-0">
                <span className="text-sm font-semibold text-text">Notes</span>
                <button
                    onClick={load}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-tertiary transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Capture form */}
            <CaptureForm onCapture={handleCapture} />

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
                {loading && (
                    <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
                        Loading…
                    </div>
                )}
                {error && (
                    <div className="flex items-center justify-center h-32 text-sm text-destructive">
                        {error}
                    </div>
                )}
                {!loading && !error && notes.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-quaternary">
                        <FileText size={28} />
                        <p className="text-sm">No notes yet</p>
                    </div>
                )}
                {!loading && !error && dates.map((date) => (
                    <div key={date}>
                        <p className={cn(
                            'text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2',
                            date === new Date().toISOString().split('T')[0] && 'text-primary-mint'
                        )}>
                            {date === new Date().toISOString().split('T')[0] ? 'Today' : date}
                        </p>
                        <div className="bg-bg-container rounded-xl border border-border overflow-hidden">
                            {grouped.get(date)!.map((note) => (
                                <NoteCard key={note.id} note={note} onDelete={handleDelete} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
