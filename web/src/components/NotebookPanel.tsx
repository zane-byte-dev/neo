import React from 'react'
import { Search, BookOpen, ArrowLeft, Calendar, User, Tag, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { notebookList, notebookSearch, notebookRead } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NoteEntry } from '../types'

// ── Note detail view ──────────────────────────────────────────────────────────

const NoteDetail: React.FC<{ note: NoteEntry; onBack: () => void }> = ({ note, onBack }) => {
    const [full, setFull] = React.useState<NoteEntry | null>(null)
    const [loading, setLoading] = React.useState(true)

    React.useEffect(() => {
        setLoading(true)
        notebookRead(note.id)
            .then((data) => setFull(data as NoteEntry))
            .catch(() => setFull(note))
            .finally(() => setLoading(false))
    }, [note.id])

    return (
        <div className="flex flex-col h-full">
            <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <button
                    onClick={onBack}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors text-text-secondary"
                >
                    <ArrowLeft size={15} />
                </button>
                <span className="text-sm font-semibold flex-1 truncate">{note.title}</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
                {/* Meta */}
                <div className="flex flex-wrap gap-3 mb-5 text-xs text-text-tertiary">
                    {note.date && (
                        <span className="flex items-center gap-1">
                            <Calendar size={11} /> {note.date}
                        </span>
                    )}
                    {note.author && (
                        <span className="flex items-center gap-1">
                            <User size={11} /> {note.author}
                        </span>
                    )}
                    {note.tags && (
                        <span className="flex items-center gap-1">
                            <Tag size={11} /> {note.tags}
                        </span>
                    )}
                </div>

                {note.summary && (
                    <div className="mb-5 p-3 bg-fill-secondary border border-border rounded-lg text-sm text-text-secondary leading-relaxed">
                        {note.summary}
                    </div>
                )}

                {loading ? (
                    <p className="text-sm text-text-tertiary italic">Loading…</p>
                ) : (
                    <div className="markdown-content text-sm leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {full?.content ?? ''}
                        </ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Entry list item ───────────────────────────────────────────────────────────

const EntryItem: React.FC<{ entry: NoteEntry; onClick: () => void }> = ({ entry, onClick }) => (
    <div
        onClick={onClick}
        className="px-4 py-3 hover:bg-fill-secondary cursor-pointer transition-colors border-b border-border last:border-b-0"
    >
        <div className="text-sm font-medium text-text truncate mb-0.5">{entry.title}</div>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
            {entry.date && <span>{entry.date}</span>}
            {entry.source && <span>· {entry.source}</span>}
        </div>
        {entry.summary && (
            <p className="text-xs text-text-tertiary mt-1 line-clamp-2 leading-relaxed">{entry.summary}</p>
        )}
    </div>
)

// ── Main notebook panel ───────────────────────────────────────────────────────

export const NotebookPanel: React.FC = () => {
    const { selectedNote, setSelectedNote, notebookEntries, setNotebookEntries } = useAppStore()
    const [searchQuery, setSearchQuery] = React.useState('')
    const [results, setResults] = React.useState<NoteEntry[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [inSearch, setInSearch] = React.useState(false)
    const searchTimeoutRef = React.useRef<number | null>(null)

    // Load all entries on mount (once)
    React.useEffect(() => {
        if (notebookEntries.length > 0) return
        setLoading(true)
        notebookList()
            .then((data) => setNotebookEntries(data as NoteEntry[]))
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false))
    }, [])

    // Debounced search
    React.useEffect(() => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
        const q = searchQuery.trim()
        if (!q) {
            setInSearch(false)
            setResults([])
            return
        }
        setInSearch(true)
        searchTimeoutRef.current = window.setTimeout(() => {
            notebookSearch(q)
                .then((data) => setResults(data as NoteEntry[]))
                .catch(() => setResults([]))
        }, 300)
    }, [searchQuery])

    if (selectedNote) {
        return <NoteDetail note={selectedNote} onBack={() => setSelectedNote(null)} />
    }

    const displayList = inSearch ? results : notebookEntries

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden">
            {/* Header */}
            <div className="h-12 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <BookOpen size={15} className="text-primary-mint shrink-0" />
                <span className="text-sm font-semibold">Notebook</span>
                <span className="ml-auto text-xs text-text-tertiary">{notebookEntries.length} entries</span>
            </div>

            {/* Search */}
            <div className="px-3 py-2.5 border-b border-border shrink-0">
                <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search notes…"
                        className="w-full bg-fill-secondary border border-border rounded-lg pl-8 pr-8 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary-mint"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-fill rounded"
                        >
                            <X size={12} className="text-text-tertiary" />
                        </button>
                    )}
                </div>
            </div>

            {/* List */}
            <div className={cn('flex-1 overflow-y-auto custom-scrollbar', !displayList.length && 'flex items-center justify-center')}>
                {loading && <p className="text-sm text-text-tertiary text-center py-8">Loading…</p>}
                {error && <p className="text-xs text-destructive text-center py-8">{error}</p>}
                {!loading && !error && displayList.length === 0 && (
                    <p className="text-xs text-text-quaternary">
                        {inSearch ? 'No results' : 'No entries'}
                    </p>
                )}
                {displayList.map((entry) => (
                    <EntryItem
                        key={entry.id}
                        entry={entry}
                        onClick={() => setSelectedNote(entry)}
                    />
                ))}
            </div>
        </div>
    )
}
