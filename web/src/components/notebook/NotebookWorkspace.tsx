/**
 * NotebookWorkspace — 知识库全屏工作区
 * 左列：文章列表（可折叠）
 * 中列：文章内容 / 编辑
 * 右侧：浮动 AI 聊天抽屉
 * 移动端：底部 tab 切换
 */
import React from 'react'
import { ArrowLeft, BookOpen, MessageSquare, Plus, Pencil, Calendar, User, Tag, Search, X, ArrowUpDown, PanelLeftOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { NotebookChatDrawer } from './NotebookChatDrawer'
import { NoteEditor } from '../NoteEditor'
import { useAppStore } from '../../stores/useAppStore'
import { cn } from '../../lib/utils'
import { notebookList, notebookRead, notebookSearch } from '../../api'
import type { NoteEntry } from '../../types'

const MOBILE_BREAKPOINT = 1024
const LIST_WIDTH = 280
const CHAT_DRAWER_WIDTH = 380

type NoteSort = 'default' | 'date-desc' | 'date-asc' | 'title'
const SORT_LABELS: Record<NoteSort, string> = {
    default: '默认', 'date-desc': '最新', 'date-asc': '最早', title: '标题',
}

interface Props {
    notebook: string
    onBack: () => void
}

type MobileTab = 'list' | 'detail' | 'chat'

export const NotebookWorkspace: React.FC<Props> = ({ notebook, onBack }) => {
    const [isMobile, setIsMobile] = React.useState(false)
    const [mobileTab, setMobileTab] = React.useState<MobileTab>('list')
    const [listCollapsed, setListCollapsed] = React.useState(false)
    const [chatOpen, setChatOpen] = React.useState(false)

    // Article list state
    const [entries, setEntries] = React.useState<NoteEntry[]>([])
    const [loading, setLoading] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [searchResults, setSearchResults] = React.useState<NoteEntry[]>([])
    const [inSearch, setInSearch] = React.useState(false)
    const [sortBy, setSortBy] = React.useState<NoteSort>('default')
    const searchTimerRef = React.useRef<number | null>(null)

    // Article detail/edit state
    const { selectedNote, setSelectedNote } = useAppStore()
    const [editing, setEditing] = React.useState<NoteEntry | null | 'new'>(null)
    const [fullContent, setFullContent] = React.useState<string>('')
    const [contentLoading, setContentLoading] = React.useState(false)

    // Bind notebook chat session
    const { openOrCreateNotebookChat, setChatSourceIds, selectedSourceIds, activeChatId } = useAppStore()
    React.useEffect(() => {
        let cancelled = false
        openOrCreateNotebookChat(notebook).catch((err) => {
            if (!cancelled) console.error('[notebook] failed to open chat session', err)
        })
        return () => { cancelled = true }
    }, [notebook, openOrCreateNotebookChat])
    React.useEffect(() => {
        if (!activeChatId) return
        const chat = useAppStore.getState().chats.find((c) => c.id === activeChatId)
        if (!chat || chat.mode !== 'notebook' || chat.notebookId !== notebook) return
        const current = chat.sourceIds ?? []
        if (current.length === selectedSourceIds.length && current.every((v, i) => v === selectedSourceIds[i])) return
        setChatSourceIds(activeChatId, selectedSourceIds).catch(() => {})
    }, [selectedSourceIds, activeChatId, notebook, setChatSourceIds])

    // Load article list
    React.useEffect(() => {
        setLoading(true)
        notebookList(notebook)
            .then((data) => setEntries(data as NoteEntry[]))
            .catch(() => setEntries([]))
            .finally(() => setLoading(false))
    }, [notebook])

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

    // Load full content when note is selected
    React.useEffect(() => {
        if (!selectedNote) { setFullContent(''); return }
        setContentLoading(true)
        notebookRead(selectedNote.id)
            .then((data) => setFullContent((data as NoteEntry).content ?? ''))
            .catch(() => setFullContent(selectedNote.content ?? ''))
            .finally(() => setContentLoading(false))
    }, [selectedNote?.id])

    // Responsive
    React.useEffect(() => {
        const handle = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
        handle()
        window.addEventListener('resize', handle)
        return () => window.removeEventListener('resize', handle)
    }, [])

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
        setEditing(null)
        if (isMobile) setMobileTab('detail')
    }

    const handleEditorSaved = (entry: NoteEntry) => {
        if (editing === 'new') {
            setEntries((prev) => [entry, ...prev])
        } else {
            setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...entry } : e)))
        }
        setEditing(null)
        setSelectedNote(entry)
        if (isMobile) setMobileTab('detail')
    }

    const handleEditorDeleted = (id: string) => {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        setEditing(null)
        setSelectedNote(null)
        if (isMobile) setMobileTab('list')
    }

    // ── Sub-views ──────────────────────────────────────────────────────────

    const articleList = (
        <ArticleList
            notebook={notebook}
            entries={sortedList}
            loading={loading}
            inSearch={inSearch}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sortBy={sortBy}
            setSortBy={setSortBy}
            totalCount={entries.length}
            selectedId={selectedNote?.id ?? null}
            onSelect={selectNote}
            onNew={() => { setEditing('new'); if (isMobile) setMobileTab('detail') }}
            onBack={onBack}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((v) => !v)}
        />
    )

    const articleDetail = editing !== null ? (
        <NoteEditor
            note={editing === 'new' ? null : editing}
            notebook={editing === 'new' ? notebook : (editing as NoteEntry).notebook}
            onBack={() => { setEditing(null); if (isMobile) setMobileTab('detail') }}
            onSaved={handleEditorSaved}
            onDeleted={handleEditorDeleted}
        />
    ) : selectedNote ? (
        <ArticleDetail
            note={selectedNote}
            fullContent={fullContent}
            loading={contentLoading}
            onEdit={() => setEditing(selectedNote)}
        />
    ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-text-quaternary gap-3 bg-white dark:bg-[#191919]">
            <BookOpen size={32} className="opacity-40" />
            <span className="text-sm">从左侧选择一篇文章</span>
        </div>
    )

    // ── Mobile ─────────────────────────────────────────────────────────────

    if (isMobile) {
        return (
            <div className="flex flex-col h-full bg-bg overflow-hidden">
                <div className="h-12 border-b border-border flex items-center gap-2 px-3 shrink-0">
                    <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg">
                        <ArrowLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold flex-1 truncate">{notebook}</span>
                </div>
                <div className="flex-1 overflow-hidden flex flex-col">
                    {mobileTab === 'list' && articleList}
                    {mobileTab === 'detail' && (
                        <div className="flex flex-col flex-1 overflow-hidden">{articleDetail}</div>
                    )}
                    {mobileTab === 'chat' && <NotebookChatDrawer notebook={notebook} onClose={() => setMobileTab('detail')} />}
                </div>
                <div className="h-14 border-t border-border flex items-center shrink-0 bg-bg-container">
                    {([
                        ['list',   BookOpen,      '文章'],
                        ['detail', Pencil,        '内容'],
                        ['chat',   MessageSquare, 'AI'],
                    ] as const).map(([k, Icon, label]) => (
                        <button
                            key={k}
                            onClick={() => setMobileTab(k)}
                            className={cn(
                                'flex-1 flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] transition-colors',
                                mobileTab === k ? 'text-primary-mint' : 'text-text-tertiary',
                            )}
                        >
                            <Icon size={16} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        )
    }

    // ── Desktop ────────────────────────────────────────────────────────────

    const workspaceRef = React.useRef<HTMLDivElement>(null)
    // Reset any stale browser-induced horizontal scroll
    React.useEffect(() => {
        if (workspaceRef.current) workspaceRef.current.scrollLeft = 0
    }, [])

    return (
        <div ref={workspaceRef} className="flex h-full bg-bg overflow-hidden relative">
            {/* Left: Article list */}
            <div
                className={cn(
                    'flex flex-col border-r border-border shrink-0 overflow-hidden bg-bg-container transition-all duration-200',
                )}
                style={{ width: listCollapsed ? 44 : LIST_WIDTH }}
            >
                {listCollapsed ? (
                    <div className="flex flex-col items-center pt-2 gap-0.5">
                        <button
                            onClick={onBack}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-fill text-text-tertiary hover:text-text transition-colors"
                            title="返回笔记本"
                        >
                            <ArrowLeft size={14} />
                        </button>
                        <button
                            onClick={() => setListCollapsed(false)}
                            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-fill text-text-tertiary hover:text-text transition-colors"
                            title="展开文章列表"
                        >
                            <PanelLeftOpen size={14} />
                        </button>
                        <button
                            onClick={() => setChatOpen((v) => !v)}
                            className={cn(
                                'w-9 h-9 flex items-center justify-center rounded-lg transition-colors',
                                chatOpen ? 'text-primary-mint bg-primary-mint/10' : 'text-text-tertiary hover:bg-fill hover:text-text',
                            )}
                            title="AI 助手"
                        >
                            <MessageSquare size={14} />
                        </button>
                    </div>
                ) : (
                    articleList
                )}
            </div>

            {/* Center: Article content — no top bar */}
            <div
                className="flex-1 min-w-0 flex flex-col overflow-hidden"
                style={{ marginRight: chatOpen ? CHAT_DRAWER_WIDTH : 0, transition: 'margin-right 200ms ease' }}
            >
                {articleDetail}
            </div>

            {/* Right: Floating chat drawer — conditionally rendered to prevent browser scroll pollution */}
            {chatOpen && (
                <div
                    className="absolute top-0 right-0 h-full border-l border-border bg-bg-container shadow-xl z-20"
                    style={{ width: CHAT_DRAWER_WIDTH }}
                >
                    <NotebookChatDrawer notebook={notebook} onClose={() => setChatOpen(false)} />
                </div>
            )}
        </div>
    )
}

// ── Article list panel ────────────────────────────────────────────────────────

const ArticleList: React.FC<{
    notebook: string
    entries: NoteEntry[]
    loading: boolean
    inSearch: boolean
    searchQuery: string
    setSearchQuery: (q: string) => void
    sortBy: NoteSort
    setSortBy: (s: NoteSort) => void
    totalCount: number
    selectedId: string | null
    onSelect: (note: NoteEntry) => void
    onNew?: () => void
    onBack: () => void
    chatOpen: boolean
    onToggleChat: () => void
}> = ({ notebook, entries, loading, inSearch, searchQuery, setSearchQuery, sortBy, setSortBy, selectedId, onSelect, onNew, onBack, chatOpen, onToggleChat }) => (
    <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-11 border-b border-border flex items-center gap-1 px-2 shrink-0 shrink-0">
            <button onClick={onBack} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors shrink-0" title="返回笔记本">
                <ArrowLeft size={13} />
            </button>
            <span className="text-xs font-medium flex-1 truncate text-text-secondary px-1">{notebook}</span>
            <button
                onClick={onToggleChat}
                className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0',
                    chatOpen ? 'text-primary-mint bg-primary-mint/10' : 'text-text-quaternary hover:bg-fill hover:text-text-secondary',
                )}
                title="AI 助手"
            >
                <MessageSquare size={13} />
            </button>
            {onNew && (
                <button onClick={onNew} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors shrink-0" title="新建文章">
                    <Plus size={13} />
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
        {/* Sort */}
        {!inSearch && (
            <div className="px-3 py-1 border-b border-border shrink-0 flex items-center gap-1">
                <ArrowUpDown size={10} className="text-text-quaternary" />
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as NoteSort)}
                    className="text-[10px] bg-transparent text-text-tertiary border-none focus:outline-none cursor-pointer flex-1"
                >
                    {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
            </div>
        )}
        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading && (
                <div className="p-3 space-y-3">
                    {[1,2,3].map(i => <div key={i} className="space-y-1.5"><div className="skeleton h-3.5 w-3/4"/><div className="skeleton h-2.5 w-1/2"/></div>)}
                </div>
            )}
            {!loading && entries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-text-quaternary gap-2 py-12">
                    <BookOpen size={20} className="opacity-40" />
                    <p className="text-xs">{inSearch ? '无搜索结果' : '暂无文章'}</p>
                </div>
            )}
            {!loading && entries.map((entry) => (
                <div
                    key={entry.id}
                    onClick={() => onSelect(entry)}
                    className={cn(
                        'mx-1 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors',
                        selectedId === entry.id
                            ? 'bg-fill text-text'
                            : 'text-text-secondary hover:bg-fill-secondary/70 hover:text-text',
                    )}
                >
                    <div className={cn('text-[13px] truncate leading-snug', selectedId === entry.id ? 'font-medium' : '')}>{entry.title}</div>
                    {entry.date && (
                        <div className="text-[10px] text-text-quaternary mt-0.5">{entry.date}</div>
                    )}
                </div>
            ))}
        </div>
    </div>
)

// ── Article detail view ───────────────────────────────────────────────────────

const ArticleDetail: React.FC<{
    note: NoteEntry
    fullContent: string
    loading: boolean
    onEdit: () => void
}> = ({ note, fullContent, loading, onEdit }) => (
    <div className="flex flex-col h-full bg-white dark:bg-[#191919]">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="max-w-[720px] mx-auto px-14 py-12">
                {/* Title row */}
                <div className="flex items-start gap-3 mb-3 group">
                    <h1 className="text-[28px] font-bold text-[#1a1a1a] dark:text-[#e8e8e8] flex-1 leading-tight tracking-tight">{note.title}</h1>
                    <button
                        onClick={onEdit}
                        className="mt-1.5 p-1.5 rounded-lg text-transparent group-hover:text-text-quaternary hover:!text-text-secondary hover:bg-gray-100 dark:hover:bg-white/10 transition-all shrink-0"
                        title="编辑"
                    >
                        <Pencil size={14} />
                    </button>
                </div>
                {/* Meta */}
                {(note.date || note.author || note.tags) && (
                    <div className="flex flex-wrap gap-3 mb-7 text-[12px] text-text-tertiary">
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
                )}
                {note.summary && (
                    <div className="mb-7 text-[13px] text-text-secondary leading-relaxed border-l-[3px] border-gray-200 dark:border-white/20 pl-4 italic">
                        {note.summary}
                    </div>
                )}
                {loading ? (
                    <div className="space-y-3">
                        {[1,2,3,4,5].map(i => <div key={i} className={`skeleton h-4 ${['w-full','w-5/6','w-4/6','w-full','w-3/4'][i-1]}`} />)}
                    </div>
                ) : (
                    <div className="markdown-content text-[15px] leading-[1.8] text-[#374151] dark:text-[#d1d5db]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullContent}</ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    </div>
)

