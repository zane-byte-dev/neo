import React from 'react'
import { Search, BookOpen, ArrowLeft, Calendar, User, Tag, X, Plus, Pencil } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { notebookList, notebookSearch, notebookRead, notebookListNotebooks } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { NoteEditor } from './NoteEditor'
import type { NoteEntry } from '../types'

// ── Note detail view ──────────────────────────────────────────────────────────

const NoteDetail: React.FC<{ note: NoteEntry; onBack: () => void; onEdit: () => void }> = ({ note, onBack, onEdit }) => {
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
            <div className="h-14 border-b border-border flex items-center gap-2 px-3 md:px-5 shrink-0 bg-bg-container/80 backdrop-blur-xl"
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <button
                    onClick={onBack}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-text"
                >
                    <ArrowLeft size={16} />
                </button>
                <span className="text-sm font-semibold flex-1 truncate tracking-tight">{note.title}</span>
                <button
                    onClick={onEdit}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-text"
                    title="编辑"
                >
                    <Pencil size={14} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
                {/* Meta */}
                <div className="flex flex-wrap gap-3 mb-6 text-xs text-text-tertiary">
                    {note.date && (
                        <span className="flex items-center gap-1.5 bg-fill-secondary px-2.5 py-1 rounded-full">
                            <Calendar size={11} /> {note.date}
                        </span>
                    )}
                    {note.author && (
                        <span className="flex items-center gap-1.5 bg-fill-secondary px-2.5 py-1 rounded-full">
                            <User size={11} /> {note.author}
                        </span>
                    )}
                    {note.tags && (
                        <span className="flex items-center gap-1.5 bg-fill-secondary px-2.5 py-1 rounded-full">
                            <Tag size={11} /> {note.tags}
                        </span>
                    )}
                </div>

                {note.summary && (
                    <div className="mb-6 p-4 bg-fill-secondary/60 border border-border rounded-xl text-sm text-text-secondary leading-relaxed"
                         style={{ boxShadow: 'var(--shadow-soft)' }}>
                        {note.summary}
                    </div>
                )}

                {loading ? (
                    <div className="space-y-3">
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-5/6" />
                        <div className="skeleton h-4 w-4/6" />
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-3/4" />
                    </div>
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

// ── Main notebook panel ───────────────────────────────────────────────────────

export const NotebookPanel: React.FC<{ fullPage?: boolean }> = ({ fullPage }) => {
    const { selectedNote, setSelectedNote, notebookEntries, setNotebookEntries } = useAppStore()
    const [notebooks, setNotebooks] = React.useState<string[]>([])
    const [selectedNotebook, setSelectedNotebook] = React.useState<string | undefined>(undefined)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [results, setResults] = React.useState<NoteEntry[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState('')
    const [inSearch, setInSearch] = React.useState(false)
    const searchTimeoutRef = React.useRef<number | null>(null)
    const [editing, setEditing] = React.useState<NoteEntry | null | 'new'>(null)
    const [isMobile, setIsMobile] = React.useState(false)

    // Load available notebooks once
    React.useEffect(() => {
        notebookListNotebooks().then(setNotebooks).catch(() => {})
    }, [])

    // Track screen size for responsive layout
    React.useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768)
        handleResize() // set correct value on mount
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Reload entries when selected notebook changes
    React.useEffect(() => {
        setLoading(true)
        setError('')
        notebookList(selectedNotebook)
            .then((data) => setNotebookEntries(data as NoteEntry[]))
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false))
    }, [selectedNotebook])

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
            notebookSearch(q, selectedNotebook)
                .then((data) => setResults(data as NoteEntry[]))
                .catch(() => setResults([]))
        }, 300)
    }, [searchQuery, selectedNotebook])

    const displayList = inSearch ? results : notebookEntries

    const handleEditorSaved = (entry: NoteEntry) => {
        if (editing === 'new') {
            setNotebookEntries([entry, ...notebookEntries])
        } else {
            setNotebookEntries(notebookEntries.map((e) => (e.id === entry.id ? { ...e, ...entry } : e)))
        }
        setEditing(null)
        setSelectedNote(entry)
    }

    const handleEditorDeleted = (id: string) => {
        setNotebookEntries(notebookEntries.filter((e) => e.id !== id))
        setEditing(null)
        setSelectedNote(null)
    }

    // ── Editor view (full-page or panel) ──────────────────────────────────
    const editorView = editing !== null && (
        <NoteEditor
            note={editing === 'new' ? null : editing}
            notebook={editing === 'new' ? (selectedNotebook ?? 'personal') : editing?.notebook}
            onBack={() => setEditing(null)}
            onSaved={handleEditorSaved}
            onDeleted={handleEditorDeleted}
        />
    )

    // ── Right pane content ────────────────────────────────────────────────
    const rightPane = editing !== null
        ? editorView
        : selectedNote
            ? <NoteDetail note={selectedNote} onBack={() => setSelectedNote(null)} onEdit={() => setEditing(selectedNote)} />
            : (
                <div className="flex-1 flex flex-col items-center justify-center text-text-quaternary text-sm gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-fill flex items-center justify-center">
                        <BookOpen size={20} className="text-text-quaternary" />
                    </div>
                    <span>选择一篇文章阅读</span>
                </div>
            )

    if (fullPage) {
        // Mobile: show list or detail, not both
        if (isMobile) {
            if (editing !== null) {
                return <div className="flex flex-col h-full bg-bg-container overflow-hidden">{editorView}</div>
            }
            if (selectedNote) {
                return (
                    <div className="flex h-full bg-bg-container overflow-hidden">
                        <NoteDetail note={selectedNote} onBack={() => setSelectedNote(null)} onEdit={() => setEditing(selectedNote)} />
                    </div>
                )
            }
            return (
                <div className="flex flex-col h-full bg-bg-container overflow-hidden">
                    <NotebookList
                        notebooks={notebooks}
                        selectedNotebook={selectedNotebook}
                        onNotebookChange={setSelectedNotebook}
                        entries={displayList}
                        loading={loading}
                        error={error}
                        inSearch={inSearch}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        totalCount={notebookEntries.length}
                        onSelect={setSelectedNote}
                        selectedId={null}
                        onNew={() => setEditing('new')}
                    />
                </div>
            )
        }

        // Desktop: side-by-side
        return (
            <div className="flex h-full bg-bg-container overflow-hidden">
                <div className="w-80 shrink-0 border-r border-border flex flex-col">
                    <NotebookList
                        notebooks={notebooks}
                        selectedNotebook={selectedNotebook}
                        onNotebookChange={setSelectedNotebook}
                        entries={displayList}
                        loading={loading}
                        error={error}
                        inSearch={inSearch}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        totalCount={notebookEntries.length}
                        onSelect={setSelectedNote}
                        selectedId={selectedNote?.id ?? null}
                        onNew={() => setEditing('new')}
                    />
                </div>
                <div className="flex-1 overflow-hidden">
                    {rightPane}
                </div>
            </div>
        )
    }

    // Non-fullPage: editor takes over
    if (editing !== null) return <div className="flex flex-col h-full bg-bg-container overflow-hidden">{editorView}</div>

    if (selectedNote) {
        return <NoteDetail note={selectedNote} onBack={() => setSelectedNote(null)} onEdit={() => setEditing(selectedNote)} />
    }

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden">
            <NotebookList
                notebooks={notebooks}
                selectedNotebook={selectedNotebook}
                onNotebookChange={setSelectedNotebook}
                entries={displayList}
                loading={loading}
                error={error}
                inSearch={inSearch}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                totalCount={notebookEntries.length}
                onSelect={setSelectedNote}
                selectedId={null}
                onNew={() => setEditing('new')}
            />
        </div>
    )
}

// ── Shared list UI ────────────────────────────────────────────────────────────

const NotebookList: React.FC<{
    notebooks: string[]
    selectedNotebook: string | undefined
    onNotebookChange: (nb: string | undefined) => void
    entries: NoteEntry[]
    loading: boolean
    error: string
    inSearch: boolean
    searchQuery: string
    setSearchQuery: (q: string) => void
    totalCount: number
    onSelect: (note: NoteEntry) => void
    selectedId: string | null
    onNew?: () => void
}> = ({ notebooks, selectedNotebook, onNotebookChange, entries, loading, error, inSearch, searchQuery, setSearchQuery, totalCount, onSelect, selectedId, onNew }) => (
    <>
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center gap-2 px-5 shrink-0 bg-bg-container/80 backdrop-blur-xl"
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            <BookOpen size={16} className="text-primary-mint shrink-0" />
            <span className="text-sm font-semibold tracking-tight">Notebook</span>
            <span className="ml-auto text-xs text-text-tertiary bg-fill px-2 py-0.5 rounded-full">{totalCount}</span>
            {onNew && (
                <button
                    onClick={onNew}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg transition-all duration-200 text-text-secondary hover:text-primary-mint"
                    title="新建文章"
                >
                    <Plus size={16} />
                </button>
            )}
        </div>

        {/* Notebook selector */}
        {notebooks.length > 0 && (
            <div className="px-3 py-2 border-b border-border shrink-0 flex gap-1.5 overflow-x-auto">
                <button
                    onClick={() => onNotebookChange(undefined)}
                    className={cn(
                        'px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-all duration-200 font-medium',
                        selectedNotebook === undefined
                            ? 'bg-primary-mint/12 text-primary-mint'
                            : 'text-text-secondary hover:bg-fill-secondary'
                    )}
                >
                    全部
                </button>
                {notebooks.map((nb) => (
                    <button
                        key={nb}
                        onClick={() => onNotebookChange(nb)}
                        className={cn(
                            'px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-all duration-200 font-medium',
                            selectedNotebook === nb
                                ? 'bg-primary-mint/12 text-primary-mint'
                                : 'text-text-secondary hover:bg-fill-secondary'
                        )}
                    >
                        {nb}
                    </button>
                ))}
            </div>
        )}

        {/* Search */}
        <div className="px-3 py-3 border-b border-border shrink-0">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search notes…"
                    className="w-full bg-fill-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-mint/30 focus:border-primary-mint/40 transition-all duration-200 placeholder:text-text-quaternary"
                />
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-fill rounded-md transition-colors"
                    >
                        <X size={12} className="text-text-tertiary" />
                    </button>
                )}
            </div>
        </div>

        {/* List */}
        <div className={cn('flex-1 overflow-y-auto custom-scrollbar', !entries.length && 'flex items-center justify-center')}>
            {loading && (
                <div className="p-4 space-y-3">
                    {[1,2,3].map(i => (
                        <div key={i} className="space-y-2">
                            <div className="skeleton h-4 w-3/4" />
                            <div className="skeleton h-3 w-1/2" />
                        </div>
                    ))}
                </div>
            )}
            {error && <p className="text-xs text-destructive text-center py-8">{error}</p>}
            {!loading && !error && entries.length === 0 && (
                <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-fill flex items-center justify-center">
                        <Search size={16} className="text-text-quaternary" />
                    </div>
                    <p className="text-xs text-text-quaternary">{inSearch ? 'No results' : 'No entries'}</p>
                </div>
            )}
            {entries.map((entry) => (
                <div
                    key={entry.id}
                    onClick={() => onSelect(entry)}
                    className={cn(
                        'px-4 py-3.5 hover:bg-fill-secondary cursor-pointer transition-all duration-200 border-b border-border-secondary last:border-b-0',
                        selectedId === entry.id && 'bg-primary-mint/6 border-l-2 border-l-primary-mint'
                    )}
                >
                    <div className="text-sm font-medium text-text truncate mb-1">{entry.title}</div>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        {entry.date && <span>{entry.date}</span>}
                        {entry.source && <span>· {entry.source}</span>}
                    </div>
                    {entry.summary && (
                        <p className="text-xs text-text-tertiary mt-1.5 line-clamp-2 leading-relaxed">{entry.summary}</p>
                    )}
                </div>
            ))}
        </div>
    </>
)
