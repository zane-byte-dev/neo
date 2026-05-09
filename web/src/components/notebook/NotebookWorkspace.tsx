/**
 * NotebookWorkspace — 知识库全屏工作区
 * 左列：文章列表（可折叠）
 * 中列：文章内容 / 编辑
 * 右侧：浮动 AI 聊天抽屉
 * 移动端：底部 tab 切换
 */
import React from 'react'
import { ArrowLeft, BookOpen, MessageSquare, Plus, Search, X, MoreHorizontal, Settings } from 'lucide-react'
import { NotebookChatDrawer } from './NotebookChatDrawer'
import { NoteEditor } from '../NoteEditor'
import { useAppStore } from '../../stores/useAppStore'
import { cn } from '../../lib/utils'
import { notebookList, notebookRead, notebookSearch, notebookDelete, notebookUpdate } from '../../api'
import { NotebookSettingsModal, getNotebookSort, setNotebookSort } from './NotebookSettingsModal'
import { confirm } from '../ConfirmDialog'
import type { NoteEntry } from '../../types'

const LIST_WIDTH = 280

type NoteSort = 'default' | 'date-desc' | 'date-asc' | 'title'

interface Props {
    notebook: string
    onBack: () => void
    startCollapsed?: boolean
    initialArticleId?: string
}

export const NotebookWorkspace: React.FC<Props> = ({ notebook, onBack, startCollapsed, initialArticleId }) => {
    const [chatOpen, setChatOpen] = React.useState(false)

    // Article list state
    const [entries, setEntries] = React.useState<NoteEntry[]>([])
    const [loading, setLoading] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [searchResults, setSearchResults] = React.useState<NoteEntry[]>([])
    const [inSearch, setInSearch] = React.useState(false)
    const [sortBy, setSortBy] = React.useState<NoteSort>(() => getNotebookSort(notebook))

    const handleSortChange = React.useCallback((s: NoteSort) => {
        setSortBy(s)
        setNotebookSort(notebook, s)
    }, [notebook])
    const searchTimerRef = React.useRef<number | null>(null)

    // Article detail/edit state
    const { selectedNote, setSelectedNote } = useAppStore()
    const [creatingNew, setCreatingNew] = React.useState(false)
    // fullContent is kept for the AI drawer (loads full text for AI operations)
    const [fullContent, setFullContent] = React.useState<string>('')

    // Bind notebook chat session — save/restore activeChatId so leaving the workspace
    // doesn't leave a notebook chat as the "active" chat.
    const [notebookChatId, setNotebookChatId] = React.useState<string | null>(null)
    const { openOrCreateNotebookChat, setChatSourceIds, selectedSourceIds } = useAppStore()
    React.useEffect(() => {
        const prevId = useAppStore.getState().activeChatId
        let cancelled = false
        openOrCreateNotebookChat(notebook)
            .then((id) => { if (!cancelled) setNotebookChatId(id) })
            .catch((err) => { if (!cancelled) console.error('[notebook] failed to open chat session', err) })
        return () => {
            cancelled = true
            // Restore the previous activeChatId when leaving the workspace
            useAppStore.setState({ activeChatId: prevId })
        }
    }, [notebook, openOrCreateNotebookChat])
    React.useEffect(() => {
        if (!notebookChatId) return
        const chat = useAppStore.getState().chats.find((c) => c.id === notebookChatId)
        if (!chat || chat.mode !== 'notebook' || chat.notebookId !== notebook) return
        const current = chat.sourceIds ?? []
        if (current.length === selectedSourceIds.length && current.every((v, i) => v === selectedSourceIds[i])) return
        setChatSourceIds(notebookChatId, selectedSourceIds).catch(() => {})
    }, [selectedSourceIds, notebookChatId, notebook, setChatSourceIds])

    // Load article list (stale-while-revalidate: keep old entries visible during switch)
    const [showListSkeleton, setShowListSkeleton] = React.useState(false)
    React.useEffect(() => {
        // Reset local UI state on notebook change
        setSelectedNote(null)
        setCreatingNew(false)
        setSearchQuery('')
        setInSearch(false)
        setSearchResults([])
        setSortBy(getNotebookSort(notebook))
        setLoading(true)
        notebookList(notebook)
            .then((data) => {
                const notes = data as NoteEntry[]
                setEntries(notes)
                if (initialArticleId) {
                    const preselect = notes.find(n => n.id === initialArticleId) ?? null
                    if (preselect) setSelectedNote(preselect)
                }
            })
            .catch(() => setEntries([]))
            .finally(() => setLoading(false))
    }, [notebook])

    // Sync article selection when initialArticleId changes (e.g. sidebar article click)
    React.useEffect(() => {
        if (!initialArticleId || entries.length === 0) return
        const found = entries.find(n => n.id === initialArticleId)
        if (found && found.id !== selectedNote?.id) {
            setSelectedNote(found)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialArticleId, entries])

    // Show skeleton only after a delay — avoids flash on fast loads
    React.useEffect(() => {
        if (!loading) { setShowListSkeleton(false); return }
        const t = window.setTimeout(() => setShowListSkeleton(true), 200)
        return () => clearTimeout(t)
    }, [loading])

    // Debounced search
    React.useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        const q = searchQuery.trim()
        if (!q) { setInSearch(false); setSearchResults([]); return }
        setInSearch(true)
        searchTimerRef.current = window.setTimeout(() => {
            notebookSearch(q, notebook).then((d) => setSearchResults(d as NoteEntry[])).catch(() => setSearchResults([]))
        }, 280)
    }, [searchQuery, notebook])

    // Load full content for the AI drawer (NoteEditor handles its own loading)
    React.useEffect(() => {
        if (!selectedNote) { setFullContent(''); return }
        setFullContent(selectedNote.content ?? '')
        notebookRead(selectedNote.id)
            .then((data) => setFullContent((data as NoteEntry).content ?? ''))
            .catch(() => {})
    }, [selectedNote?.id])

    // Track recently viewed articles in localStorage
    React.useEffect(() => {
        if (!selectedNote) return
        try {
            const raw = localStorage.getItem('neo:recentArticles')
            const recent: Array<{ id: string; title: string; notebook: string }> = raw ? JSON.parse(raw) : []
            const updated = [
                { id: selectedNote.id, title: selectedNote.title, notebook },
                ...recent.filter(a => a.id !== selectedNote.id),
            ].slice(0, 8)
            localStorage.setItem('neo:recentArticles', JSON.stringify(updated))
        } catch { /* ignore */ }
    }, [selectedNote?.id, notebook])

    // Workspace scroll reset on notebook change
    const workspaceRef = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
        if (workspaceRef.current) workspaceRef.current.scrollLeft = 0
    }, [notebook])

    const displayList = inSearch ? searchResults : entries
    const sortedList = React.useMemo(() => {
        const arr = [...displayList]
        if (sortBy === 'date-desc') arr.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        else if (sortBy === 'date-asc') arr.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
        else if (sortBy === 'title') arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
        return arr
    }, [displayList, sortBy])

    const selectNote = (note: NoteEntry) => {
        setSelectedNote(note)
        setCreatingNew(false)
    }

    // Called when a new note is first saved
    const handleNewNoteSaved = (entry: NoteEntry) => {
        setEntries((prev) => [entry, ...prev])
        setCreatingNew(false)
        setSelectedNote(entry)
    }

    // Called silently by auto-save for existing notes
    const handleAutoSaved = React.useCallback((entry: NoteEntry) => {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, ...entry } : e))
        setSelectedNote(entry)
        setFullContent(entry.content ?? '')
    }, [setSelectedNote])

    const handleEditorDeleted = (id: string) => {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        setCreatingNew(false)
        setSelectedNote(null)
    }

    // Apply AI edits to a note (called from DocDiffModal via NotebookChatDrawer)
    const handleNoteApply = React.useCallback(async (noteId: string, newContent: string) => {
        await notebookUpdate(noteId, { content: newContent })
        setFullContent(newContent)
        setEntries((prev) => prev.map((e) => e.id === noteId ? { ...e, content: newContent } : e))
        const current = useAppStore.getState().selectedNote
        if (current?.id === noteId) setSelectedNote({ ...current, content: newContent })
    }, [setSelectedNote])

    // ── Sub-views ──────────────────────────────────────────────────────────

    const handleDeleteEntry = async (entry: NoteEntry) => {
        const ok = await confirm(`删除「${entry.title}」？`, { destructive: true, confirmText: '删除' })
        if (!ok) return
        try {
            await notebookDelete(entry.id)
            setEntries((prev) => prev.filter((e) => e.id !== entry.id))
            if (selectedNote?.id === entry.id) setSelectedNote(null)
        } catch { /* silent */ }
    }

    const [settingsOpen, setSettingsOpen] = React.useState(false)

    const articleList = (
        <ArticleList
            notebook={notebook}
            entries={sortedList}
            loading={showListSkeleton}
            stale={loading}
            inSearch={inSearch}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sortBy={sortBy}
            setSortBy={handleSortChange}
            totalCount={entries.length}
            onSelect={selectNote}
            onEdit={(entry) => { selectNote(entry) }}
            onDelete={handleDeleteEntry}
            onNew={() => { setCreatingNew(true) }}
            onBack={onBack}
            onOpenSettings={() => setSettingsOpen(true)}
        />
    )

    const articleDetail = creatingNew ? (
        <NoteEditor
            note={null}
            notebook={notebook}
            onBack={() => { setCreatingNew(false) }}
            onSaved={handleNewNoteSaved}
            onDeleted={handleEditorDeleted}
        />
    ) : selectedNote ? (
        <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            notebook={selectedNote.notebook}
            autoSave
            onBack={() => {}}
            onSaved={handleAutoSaved}
            onDeleted={handleEditorDeleted}
        />
    ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-text-quaternary gap-3 bg-white dark:bg-[#191919]">
            <BookOpen size={32} className="opacity-40" />
            <span className="text-sm">从左侧选择一篇文章</span>
        </div>
    )

    return (
        <div ref={workspaceRef} className="flex h-full bg-bg overflow-hidden relative">
            {settingsOpen && (
                <NotebookSettingsModal
                    notebook={notebook}
                    onSortChange={handleSortChange}
                    onClose={() => setSettingsOpen(false)}
                    onRenamed={(newName) => { onBack(); window.location.replace(`/notebook/${encodeURIComponent(newName)}`) }}
                />
            )}
            {/* Left: Article list — only shown when not in startCollapsed mode */}
            {!startCollapsed && (
                <div
                    className="flex flex-col border-r border-border shrink-0 overflow-hidden bg-bg-container transition-all duration-200"
                    style={{ width: LIST_WIDTH }}
                >
                    {articleList}
                </div>
            )}

            {/* Center: Article content — full width, chat floats over it */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {articleDetail}
            </div>

            {/* Right-bottom: Floating chat popover — sits above the FAB */}
            {chatOpen && (
                <div
                    className="absolute bottom-16 right-4 flex flex-col rounded-2xl border border-border bg-bg-container shadow-2xl z-30 overflow-hidden"
                    style={{ width: 340, height: 500 }}
                >
                    <NotebookChatDrawer notebook={notebook} selectedNote={selectedNote} fullContent={fullContent} onClose={() => setChatOpen(false)} onNoteApply={handleNoteApply} />
                </div>
            )}

            {/* FAB — always-visible chat toggle */}
            <button
                onClick={() => setChatOpen((v) => !v)}
                className={cn(
                    'absolute bottom-4 right-4 w-10 h-10 flex items-center justify-center rounded-full shadow-lg z-30 transition-all duration-150',
                    chatOpen
                        ? 'bg-primary-mint text-white rotate-90'
                        : 'bg-bg-container border border-border text-text-secondary hover:text-primary-mint hover:border-primary-mint/50',
                )}
                title={chatOpen ? '收起 AI 助手' : 'AI 助手'}
            >
                {chatOpen ? <X size={16} /> : <MessageSquare size={15} />}
            </button>
        </div>
    )
}

// ── Article list panel ────────────────────────────────────────────────────────

const ArticleList: React.FC<{
    notebook: string
    entries: NoteEntry[]
    loading: boolean
    stale?: boolean
    inSearch: boolean
    searchQuery: string
    setSearchQuery: (q: string) => void
    sortBy: NoteSort
    setSortBy: (s: NoteSort) => void
    totalCount: number
    onSelect: (note: NoteEntry) => void
    onEdit: (note: NoteEntry) => void
    onDelete: (note: NoteEntry) => void
    onNew?: () => void
    onBack: () => void
    onOpenSettings?: () => void
}> = ({ notebook, entries, loading, stale, inSearch, searchQuery, setSearchQuery, onSelect, onEdit, onDelete, onNew, onBack, onOpenSettings }) => (
    <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-11 border-b border-border flex items-center gap-1 px-2 shrink-0">
            <button onClick={onBack} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors shrink-0" title="返回笔记本">
                <ArrowLeft size={13} />
            </button>
            <span className="text-xs font-medium flex-1 truncate text-text-secondary px-1">{notebook}</span>
            {onNew && (
                <button onClick={onNew} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors shrink-0" title="新建文章">
                    <Plus size={13} />
                </button>
            )}
            {onOpenSettings && (
                <button onClick={onOpenSettings} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors shrink-0" title="笔记本设置">
                    <Settings size={13} />
                </button>
            )}
        </div>
        {/* Search */}
        <div className="px-2.5 py-2 border-b border-border shrink-0">
                <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索文章…"
                        className="w-full bg-fill-secondary border border-border rounded-lg pl-7 pr-7 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-mint/40 placeholder:text-text-quaternary transition-all"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                            <X size={11} className="text-text-tertiary" />
                        </button>
                    )}
                </div>
            </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Skeleton: only when loading with no entries yet */}
            {loading && entries.length === 0 && (
                <div className="p-3 space-y-3">
                    {[1,2,3].map(i => <div key={i} className="space-y-1.5"><div className="skeleton h-3.5 w-3/4"/><div className="skeleton h-2.5 w-1/2"/></div>)}
                </div>
            )}
            {/* Empty state: only when fully loaded */}
            {!stale && !loading && entries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-text-quaternary gap-2 py-12">
                    <BookOpen size={20} className="opacity-40" />
                    <p className="text-xs">{inSearch ? '无搜索结果' : '暂无文章'}</p>
                </div>
            )}
            {entries.map((entry) => (
                <ArticleListItem
                    key={entry.id}
                    entry={entry}
                    stale={!!stale}
                    onSelect={onSelect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ))}
        </div>
    </div>
)

// ── Article list item ─────────────────────────────────────────────────────────

const ArticleListItem: React.FC<{
    entry: NoteEntry
    stale: boolean
    onSelect: (e: NoteEntry) => void
    onEdit: (e: NoteEntry) => void
    onDelete: (e: NoteEntry) => void
}> = ({ entry, stale, onSelect, onEdit, onDelete }) => {
    const [menuOpen, setMenuOpen] = React.useState(false)
    const menuRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [menuOpen])

    return (
        <div
            onClick={() => !stale && onSelect(entry)}
            className={cn(
                'group mx-1 px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-200 relative',
                stale ? 'opacity-40 pointer-events-none' : '',
                'text-text-secondary hover:bg-fill-secondary/70 hover:text-text',
            )}
        >
            <div className="flex items-center gap-1">
                <span className="text-[13px] truncate leading-snug flex-1" title={entry.title}>{entry.title}</span>
                <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-fill transition-opacity"
                >
                    <MoreHorizontal size={13} />
                </button>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
                {entry.date && <span className="text-[10px] text-text-quaternary">{entry.date}</span>}
                {entry.source === 'ai-chat' && <span className="text-[9px] px-1 py-0.5 rounded bg-primary-mint/15 text-primary-mint">AI 对话</span>}
            </div>
            {menuOpen && (
                <div
                    ref={menuRef}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-full mt-0.5 z-50 bg-bg-container border border-border rounded-lg shadow-lg py-0.5 min-w-[110px]"
                >
                    <button
                        onClick={() => { setMenuOpen(false); onEdit(entry) }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-fill-secondary transition-colors"
                    >
                        编辑
                    </button>
                    <button
                        onClick={() => { setMenuOpen(false); onDelete(entry) }}
                        className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-fill-secondary transition-colors"
                    >
                        删除
                    </button>
                </div>
            )}
        </div>
    )
}
