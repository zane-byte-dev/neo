import React from 'react'
import { Pin, PinOff, Archive, ArchiveRestore, Loader2, AlertTriangle, Trash2, MoreHorizontal, Palette, LogOut, Search, X, Pencil, Globe, BookOpen, ChevronDown, ChevronRight, MessageSquarePlus, PanelLeftClose, Plus, Settings, CheckSquare, Square, Upload, Home, MessageSquare } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { logout, fetchMe, fetchSessions, patchSession, deleteSessionApi, notebookListNotebooks, notebookDeleteFolder, notebookRenameFolder, initializeWorkspace, importChatApi, notebookList, type MeInfo } from '../api'
import { useT, LOCALE_OPTIONS } from '../i18n'
import { toast } from './Toast'
import { confirm as confirmDialog } from './ConfirmDialog'
import { NotebookSettingsModal, getNotebookSort, applySortToEntries } from './notebook/NotebookSettingsModal'
import { TrashPanel } from './TrashPanel'
import type { Theme, NoteEntry } from '../types'

/** Highlight occurrences of `query` inside `text` with a mark span. */
function HighlightText({ text, query }: { text: string; query: string }) {
    if (!query) return <>{text}</>
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return <>{text}</>
    return (
        <>
            {text.slice(0, idx)}
            <mark className="bg-primary-mint/25 text-inherit rounded-[2px] px-px">{text.slice(idx, idx + query.length)}</mark>
            {text.slice(idx + query.length)}
        </>
    )
}

function parseImportedChatFile(raw: string, filename: string): { title: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
    try {
        const data = JSON.parse(raw) as Record<string, unknown>
        const trimmedTitle = typeof data.title === 'string' ? data.title.trim() : ''
        const title = trimmedTitle || filename.replace(/\.[^.]+$/, '')
        const messages = Array.isArray(data.messages)
            ? data.messages.map((item) => typeof item === 'object' && item !== null ? item as Record<string, unknown> : null)
                .filter((item): item is Record<string, unknown> => item !== null)
                .map((item) => ({
                    role: item.role === 'assistant' || item.role === 'model' ? 'assistant' as const : 'user' as const,
                    content: typeof item.content === 'string' ? item.content : '',
                }))
                .filter((item) => item.content.trim())
            : []
        if (messages.length > 0) return { title, messages }
    } catch { /* parse markdown below */ }

    const lines = raw.replace(/\r/g, '').split('\n')
    const titleLine = lines.find((line) => line.startsWith('# '))
    const title = titleLine?.replace(/^#\s+/, '').trim() || filename.replace(/\.[^.]+$/, '')
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    let current: { role: 'user' | 'assistant'; content: string[] } | null = null
    for (const line of lines) {
        const heading = line.match(/^###\s+(.*)$/)
        if (heading) {
            if (current && current.content.join('\n').trim()) {
                messages.push({ role: current.role, content: current.content.join('\n').trim() })
            }
            const label = heading[1].toLowerCase()
            current = { role: label.includes('neo') || label.includes('assistant') ? 'assistant' : 'user', content: [] }
            continue
        }
        if (current) current.content.push(line)
    }
    if (current && current.content.join('\n').trim()) {
        messages.push({ role: current.role, content: current.content.join('\n').trim() })
    }
    return { title, messages }
}

const THEMES: { value: Theme; labelKey: 'themeLight' | 'themeDark' | 'themeClassicDark' }[] = [
    { value: 'light', labelKey: 'themeLight' },
    { value: 'dark', labelKey: 'themeDark' },
    { value: 'classic-dark', labelKey: 'themeClassicDark' },
]

const LONG_PRESS_MOVE_THRESHOLD = 10
const CONTEXT_MENU_HEIGHT_BUFFER = 120
const CONTEXT_MENU_WIDTH_BUFFER = 170

export const Sidebar: React.FC<{ onNavigate?: () => void; onCollapse?: () => void }> = ({ onNavigate, onCollapse }) => {
    const { chats, activeChatId, selectChat, createChat, deleteChat, pinChat, archiveChat, renameChat, setTheme, theme, setChats, locale, setLocale } = useAppStore()
    const generatingBySession = useAppStore(s => s.generatingBySession)
    const messagesBySession = useAppStore(s => s.messages)
    const t = useT()
    const location = useLocation()
    const navigate = useNavigate()
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [notebookOpen, setNotebookOpen] = React.useState(false)
    const [notebooks, setNotebooks] = React.useState<string[]>([])
    const [addingNotebook, setAddingNotebook] = React.useState(false)
    const [newNotebookName, setNewNotebookName] = React.useState('')
    const [notebookContextMenu, setNotebookContextMenu] = React.useState<{ name: string; x: number; y: number } | null>(null)
    const [confirmDeleteNotebook, setConfirmDeleteNotebook] = React.useState<string | null>(null)
    const [renamingNotebook, setRenamingNotebook] = React.useState<string | null>(null)
    const [notebookRenameValue, setNotebookRenameValue] = React.useState('')
    const [notebookSettingsFor, setNotebookSettingsFor] = React.useState<string | null>(null)
    const [contextMenu, setContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
    const [trashOpen, setTrashOpen] = React.useState(false)
    const [me, setMe] = React.useState<MeInfo | null>(null)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
    const [renamingChat, setRenamingChat] = React.useState<{ id: string; title: string } | null>(null)
    const [renameValue, setRenameValue] = React.useState('')
    const [initializingWorkspace, setInitializingWorkspace] = React.useState(false)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const renameInputRef = React.useRef<HTMLInputElement>(null)
    const importInputRef = React.useRef<HTMLInputElement>(null)
    const longPressTimerRef = React.useRef<number | null>(null)
    const cancelNotebookCommitRef = React.useRef(false)

    // Sidebar tab state
    type SidebarTab = 'home' | 'chat' | 'articles'
    const getInitialTab = (): SidebarTab => {
        if (location.pathname.startsWith('/notebook')) return 'articles'
        if (location.pathname.startsWith('/chat')) return 'chat'
        return 'home'
    }
    const [activeTab, setActiveTab] = React.useState<SidebarTab>(getInitialTab)
    // Track whether the user explicitly selected the home tab (prevents /chat sync from overriding it)
    const explicitHomeRef = React.useRef(false)
    // Recently viewed articles (from localStorage)
    const [recentArticles, setRecentArticles] = React.useState<Array<{ id: string; title: string; notebook: string }>>(() => {
        try { return JSON.parse(localStorage.getItem('neo:recentArticles') ?? '[]') } catch { return [] }
    })
    // Refresh recentArticles when home tab is activated
    React.useEffect(() => {
        if (activeTab !== 'home') return
        try { setRecentArticles(JSON.parse(localStorage.getItem('neo:recentArticles') ?? '[]')) } catch { /* ignore */ }
    }, [activeTab])

    // Sync tab with navigation
    React.useEffect(() => {
        if (location.pathname.startsWith('/notebook')) {
            explicitHomeRef.current = false
            setActiveTab('articles')
        } else if (location.pathname.startsWith('/chat')) {
            if (!explicitHomeRef.current) setActiveTab('chat')
        }
    }, [location.pathname])

    // Articles tab: per-notebook expanded state and loaded articles
    const [expandedNbs, setExpandedNbs] = React.useState<Set<string>>(new Set())
    const [nbArticles, setNbArticles] = React.useState<Record<string, NoteEntry[]>>({})
    const [loadingNbs, setLoadingNbs] = React.useState<Set<string>>(new Set())
    const [nbSortState, setNbSortState] = React.useState<Record<string, string>>({})

    const toggleNotebookExpand = async (nb: string) => {
        setExpandedNbs((prev) => {
            const next = new Set(prev)
            if (next.has(nb)) { next.delete(nb); return next }
            next.add(nb)
            return next
        })
        if (!nbArticles[nb]) {
            setLoadingNbs((prev) => new Set(prev).add(nb))
            try {
                const articles = await notebookList(nb) as NoteEntry[]
                setNbArticles((prev) => ({ ...prev, [nb]: articles }))
            } catch { /* ignore */ }
            finally {
                setLoadingNbs((prev) => { const next = new Set(prev); next.delete(nb); return next })
            }
        }
    }

    // Multi-select state
    const [selectMode, setSelectMode] = React.useState(false)
    const [selectedChatIds, setSelectedChatIds] = React.useState<Set<string>>(new Set())

    const toggleSelectMode = () => {
        setSelectMode((v) => !v)
        setSelectedChatIds(new Set())
    }

    const toggleSelectChat = (id: string) => {
        setSelectedChatIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const selectAllVisible = (ids: string[]) => {
        setSelectedChatIds(new Set(ids))
    }

    const handleBulkDelete = async () => {
        const ids = Array.from(selectedChatIds)
        if (ids.length === 0) return
        const confirmed = await confirmDialog(t('bulkDeleteConfirm', { n: ids.length }), {
            confirmText: t('delete'),
            cancelText: t('cancel'),
            destructive: true,
        })
        if (!confirmed) return
        for (const id of ids) {
            deleteSessionApi(id).catch(() => {})
            deleteChat(id)
        }
        toast.success(t('bulkDeleteSuccess').replace('{n}', String(ids.length)))
        setSelectedChatIds(new Set())
        setSelectMode(false)
    }

    const handleBulkArchive = (archived: boolean) => {
        const ids = Array.from(selectedChatIds)
        if (ids.length === 0) return
        for (const id of ids) {
            archiveChat(id, archived)
            patchSession(id, { isArchived: archived }).catch(() => {})
        }
        const key = archived ? 'bulkArchiveSuccess' : 'bulkUnarchiveSuccess'
        toast.success(t(key).replace('{n}', String(ids.length)))
        setSelectedChatIds(new Set())
        setSelectMode(false)
    }

    React.useEffect(() => {
        fetchMe().then(setMe).catch(() => {})
    }, [])

    // Load session list from server on mount
    React.useEffect(() => {
        fetchSessions()
            .then((rows) => setChats(rows.map((r) => ({
                id: r.id,
                title: r.title,
                isPinned: r.isPinned,
                isArchived: r.isArchived ?? false,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt ?? r.createdAt,
                projectRoot: r.projectRoot ?? null,
                mode: r.mode ?? 'general',
                ...(r.notebookId ? { notebookId: r.notebookId } : {}),
                ...(r.sourceIds ? { sourceIds: r.sourceIds } : {}),
                ...(r.chatModel ? { chatModel: r.chatModel } : {}),
            }))))
            .catch(() => {})
    }, [])

    // Load notebooks when section is expanded or articles tab is activated
    React.useEffect(() => {
        if (!notebookOpen && activeTab !== 'articles') return
        notebookListNotebooks().then(setNotebooks).catch(() => {})
    }, [notebookOpen, activeTab])

    const commitNewNotebook = React.useCallback(() => {
        if (cancelNotebookCommitRef.current) {
            cancelNotebookCommitRef.current = false
            setAddingNotebook(false)
            setNewNotebookName('')
            return
        }
        const name = newNotebookName.trim()
        if (!name) {
            setAddingNotebook(false)
            setNewNotebookName('')
            return
        }
        if (!notebooks.includes(name)) setNotebooks([...notebooks, name])
        navigate(`/notebook/article/new?notebook=${encodeURIComponent(name)}`)
        setNewNotebookName('')
        setAddingNotebook(false)
        onNavigate?.()
    }, [navigate, newNotebookName, notebooks, onNavigate])

    const handleDelete = (id: string) => {
        setConfirmDelete(id)
    }

    const confirmDeleteChat = () => {
        if (!confirmDelete) return
        deleteSessionApi(confirmDelete).catch(() => {})
        deleteChat(confirmDelete)
        setConfirmDelete(null)
    }

    const handleRename = (id: string) => {
        const chat = chats.find((c) => c.id === id)
        if (chat) {
            setRenamingChat({ id, title: chat.title })
            setRenameValue(chat.title)
        }
    }

    const confirmRename = () => {
        if (!renamingChat || !renameValue.trim()) return
        renameChat(renamingChat.id, renameValue.trim())
        patchSession(renamingChat.id, { title: renameValue.trim() }).catch(() => {})
        setRenamingChat(null)
        setRenameValue('')
    }

    // Focus rename input when dialog opens
    React.useEffect(() => {
        if (renamingChat) {
            setTimeout(() => renameInputRef.current?.select(), 50)
        }
    }, [renamingChat])

    const handlePin = (id: string) => {
        const chat = chats.find((c) => c.id === id)
        if (chat) patchSession(id, { isPinned: !chat.isPinned }).catch(() => {})
        pinChat(id)
    }

    const handleArchive = (id: string, archived: boolean) => {
        archiveChat(id, archived)
        patchSession(id, { isArchived: archived }).catch(() => {})
    }

    // Persisted collapse state for chat groups
    const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>(() => {
        try {
            const raw = localStorage.getItem('neo:sidebar:collapsedGroups')
            if (raw) return JSON.parse(raw)
        } catch { /* ignore */ }
        // Archived collapsed by default
        return { archived: true }
    })
    const toggleGroup = (key: string) => {
        setCollapsedGroups((prev) => {
            const next = { ...prev, [key]: !prev[key] }
            try { localStorage.setItem('neo:sidebar:collapsedGroups', JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }

    const handleLogout = () => {
        logout().finally(() => window.location.reload())
    }

    const handleInitializeWorkspace = async () => {
        if (initializingWorkspace) return
        setInitializingWorkspace(true)
        try {
            const nextMe = await initializeWorkspace()
            setMe(nextMe)
            const nextNotebooks = await notebookListNotebooks().catch(() => notebooks)
            setNotebooks(nextNotebooks)
            setNotebookOpen(true)
            setMenuOpen(false)
            toast.success(t('workspaceInitSuccess'))
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : t('workspaceInitFailed'))
        } finally {
            setInitializingWorkspace(false)
        }
    }

    const handleImportChat = async (file: File | undefined) => {
        if (!file) return
        try {
            const parsed = parseImportedChatFile(await file.text(), file.name)
            if (parsed.messages.length === 0) throw new Error(t('importChatNoMessages'))
            const res = await importChatApi(parsed.title, parsed.messages)
            setChats([{
                id: res.session.id,
                title: res.session.title,
                isPinned: res.session.isPinned,
                isArchived: res.session.isArchived ?? false,
                createdAt: res.session.createdAt,
                updatedAt: res.session.updatedAt ?? res.session.createdAt,
                projectRoot: res.session.projectRoot,
                mode: res.session.mode ?? 'general',
            }, ...chats])
            selectChat(res.session.id)
            navigate('/chat')
            setMenuOpen(false)
            toast.success(t('importChatSuccess'))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('importChatFailed'))
        } finally {
            if (importInputRef.current) importInputRef.current.value = ''
        }
    }

    const handleChatRightClick = (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        setContextMenu({ id, x: e.clientX, y: e.clientY })
    }

    const handleNotebookContextMenu = (e: React.MouseEvent, name: string) => {
        e.preventDefault()
        e.stopPropagation()
        setNotebookContextMenu({ name, x: e.clientX, y: e.clientY })
    }

    const confirmDeleteNotebookAction = async () => {
        if (!confirmDeleteNotebook) return
        try {
            await notebookDeleteFolder(confirmDeleteNotebook)
            setNotebooks(prev => prev.filter(n => n !== confirmDeleteNotebook))
            if (location.pathname === `/notebook/${encodeURIComponent(confirmDeleteNotebook)}`) navigate('/chat')
            toast.success(t('notebookDeleted'))
        } catch {
            toast.error(t('notebookDeleteFailed'))
        } finally {
            setConfirmDeleteNotebook(null)
        }
    }

    const confirmRenameNotebook = async () => {
        if (!renamingNotebook || !notebookRenameValue.trim()) return
        const newName = notebookRenameValue.trim()
        try {
            await notebookRenameFolder(renamingNotebook, newName)
            setNotebooks(prev => prev.map(n => n === renamingNotebook ? newName : n))
            if (location.pathname === `/notebook/${encodeURIComponent(renamingNotebook)}`) {
                navigate(`/notebook/${encodeURIComponent(newName)}`)
            }
            toast.success(t('notebookRenamed'))
        } catch {
            toast.error(t('notebookRenameFailed'))
        } finally {
            setRenamingNotebook(null)
            setNotebookRenameValue('')
        }
    }

    // Close notebook context menu on outside click
    React.useEffect(() => {
        if (!notebookContextMenu) return
        const close = () => setNotebookContextMenu(null)
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [notebookContextMenu])

    // Focus notebook rename input when dialog opens
    const notebookRenameInputRef = React.useRef<HTMLInputElement>(null)
    React.useEffect(() => {
        if (renamingNotebook) setTimeout(() => notebookRenameInputRef.current?.select(), 50)
    }, [renamingNotebook])

    // Long-press support for mobile context menu
    const touchStartPos = React.useRef<{ x: number; y: number } | null>(null)

    const handleTouchStart = (e: React.TouchEvent, id: string) => {
        const touch = e.touches[0]
        const x = touch.clientX
        const y = touch.clientY
        touchStartPos.current = { x, y }
        longPressTimerRef.current = window.setTimeout(() => {
            setContextMenu({ id, x, y })
        }, 500)
    }

    const handleTouchEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }
        touchStartPos.current = null
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (longPressTimerRef.current && touchStartPos.current) {
            const touch = e.touches[0]
            const dx = Math.abs(touch.clientX - touchStartPos.current.x)
            const dy = Math.abs(touch.clientY - touchStartPos.current.y)
            if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
                clearTimeout(longPressTimerRef.current)
                longPressTimerRef.current = null
            }
        }
    }

    // Close context menu on click outside
    React.useEffect(() => {
        if (!contextMenu) return
        const close = () => setContextMenu(null)
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [contextMenu])

    return (
        <div className="flex flex-col h-full bg-bg-sidebar border-r border-border w-full overflow-hidden select-none">
            {/* Logo */}
            <div className="px-3 pt-3.5 pb-2">
                <div className="flex items-center gap-2 px-2">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary-mint to-emerald-600 flex items-center justify-center shrink-0">
                        <span className="text-white text-[10px] font-bold leading-none">N</span>
                    </div>
                    <span className="text-[13px] font-bold tracking-tight text-text flex-1">Neo</span>
                    {onCollapse && (
                        <button
                            onClick={onCollapse}
                            className="p-1 rounded-md text-text-quaternary hover:text-text-secondary hover:bg-sidebar-hover transition-all duration-150"
                            title="Collapse sidebar"
                        >
                            <PanelLeftClose size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Notion-style Tab Bar */}
            <div className="flex items-center gap-1 border-b border-border px-2 h-11 shrink-0">
                {([
                    { key: 'home' as const, Icon: Home, label: t('tabHome') },
                    { key: 'chat' as const, Icon: MessageSquare, label: t('tabChat') },
                    { key: 'articles' as const, Icon: BookOpen, label: t('tabArticles') },
                ]).map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => {
                            if (tab.key === 'home') {
                                explicitHomeRef.current = true
                                setActiveTab('home')
                            } else {
                                explicitHomeRef.current = false
                                setActiveTab(tab.key)
                                if (tab.key === 'chat') navigate('/chat')
                            }
                        }}
                        className={cn(
                            'h-7 flex items-center gap-1.5 rounded-md px-2 text-[13px] transition-all duration-150 cursor-pointer shrink-0',
                            activeTab === tab.key
                                ? 'bg-fill text-text font-medium'
                                : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                        )}
                    >
                        <tab.Icon size={15} className="shrink-0" />
                        {activeTab === tab.key && <span>{tab.label}</span>}
                    </button>
                ))}
                <div className="flex-1" />
                <button
                    onClick={() => {
                        explicitHomeRef.current = false
                        setActiveTab('chat')
                        navigate('/chat')
                        setTimeout(() => searchRef.current?.focus(), 100)
                    }}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150"
                    title={t('searchChats')}
                >
                    <Search size={15} />
                </button>
            </div>

            {/* ── Home Tab ── */}
            {activeTab === 'home' && (() => {
                const pinnedChats = chats.filter(c => c.isPinned && !c.isArchived && c.mode !== 'notebook')
                const recentChats = [...chats]
                    .filter(c => !c.isArchived && c.mode !== 'notebook')
                    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
                    .slice(0, 5)
                const sectionLabel = 'text-[11px] font-semibold text-text-quaternary uppercase tracking-wide px-1 mb-1'
                const chatRow = (chat: typeof chats[number]) => (
                    <div
                        key={chat.id}
                        onClick={() => {
                            explicitHomeRef.current = false
                            selectChat(chat.id)
                            navigate('/chat')
                            onNavigate?.()
                        }}
                        className="flex items-center gap-2 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150 text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text"
                    >
                        <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-text-quaternary/70" />
                        <span className="flex-1 truncate">{chat.title}</span>
                    </div>
                )
                return (
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-4">
                        {/* Quick actions */}
                        <div className="space-y-0.5">
                            <button
                                onClick={() => { explicitHomeRef.current = false; createChat(); navigate('/chat'); setActiveTab('chat'); onNavigate?.() }}
                                className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150 cursor-pointer"
                            >
                                <MessageSquarePlus size={15} className="shrink-0 text-text-tertiary" />
                                <span>{t('newChat')}</span>
                            </button>
                            <Link
                                to="/settings"
                                onClick={() => { explicitHomeRef.current = false; onNavigate?.() }}
                                className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150"
                            >
                                <Settings size={15} className="shrink-0 text-text-tertiary" />
                                <span>{t('settings')}</span>
                            </Link>
                        </div>

                        {/* Pinned chats */}
                        {pinnedChats.length > 0 && (
                            <div>
                                <p className={sectionLabel}>📌 置顶对话</p>
                                <div className="space-y-px">{pinnedChats.map(chatRow)}</div>
                            </div>
                        )}

                        {/* Recent chats */}
                        {recentChats.length > 0 && (
                            <div>
                                <p className={sectionLabel}>🕐 最近对话</p>
                                <div className="space-y-px">{recentChats.map(chatRow)}</div>
                            </div>
                        )}

                        {/* Recent articles */}
                        {recentArticles.length > 0 && (
                            <div>
                                <p className={sectionLabel}>📄 最近文章</p>
                                <div className="space-y-px">
                                    {recentArticles.map(article => (
                                        <Link
                                            key={article.id}
                                            to={`/notebook/${encodeURIComponent(article.notebook)}?article=${encodeURIComponent(article.id)}`}
                                            onClick={() => { explicitHomeRef.current = false; onNavigate?.() }}
                                            className="flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150"
                                        >
                                            <BookOpen size={13} className="shrink-0 text-text-quaternary" />
                                            <span className="flex-1 truncate">{article.title}</span>
                                            <span className="text-[11px] text-text-quaternary shrink-0">{article.notebook}</span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )
            })()}

            {/* ── Chat Tab ── */}
            {activeTab === 'chat' && (
                <>
                    {/* Search + New Chat */}
                    <div className="px-3 pt-2.5 pb-1 space-y-1.5 border-b border-border">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('searchChats')}
                                className="w-full bg-sidebar-hover border border-transparent rounded-lg pl-8 pr-8 py-[7px] text-[13px] placeholder:text-text-quaternary focus:outline-none focus:bg-bg-container focus:border-border focus:ring-1 focus:ring-primary-mint/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-fill transition-colors"
                                >
                                    <X size={12} className="text-text-tertiary" />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => { createChat(); navigate('/chat'); onNavigate?.() }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150 cursor-pointer"
                        >
                            <MessageSquarePlus size={15} className="shrink-0 text-text-tertiary" />
                            <span>{t('newChat')}</span>
                        </button>
                    </div>

                    {/* Chat list */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
                        <div className="flex items-center px-2.5 mb-1.5">
                            <p className="text-[11px] font-medium text-text-quaternary uppercase tracking-wider flex-1">{t('chats') ?? 'Chats'}</p>
                            <button
                                type="button"
                                onClick={toggleSelectMode}
                                className={cn(
                                    'text-[11px] px-1.5 py-0.5 rounded transition-colors',
                                    selectMode ? 'text-primary-mint hover:text-primary-mint/80' : 'text-text-quaternary hover:text-text-tertiary'
                                )}
                            >
                                {selectMode ? t('cancelSelect') : t('selectChats')}
                            </button>
                        </div>
                        {/* Bulk action toolbar */}
                        {selectMode && (
                            <div className="flex items-center gap-1.5 px-1 pb-2 flex-wrap">
                                <span className="text-[11px] text-text-tertiary flex-1">
                                    {t('selectedCount').replace('{n}', String(selectedChatIds.size))}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const q = searchQuery.toLowerCase().trim()
                                        const visible = (q ? chats.filter(c => c.title.toLowerCase().includes(q)) : chats).map(c => c.id)
                                        if (selectedChatIds.size === visible.length) setSelectedChatIds(new Set())
                                        else selectAllVisible(visible)
                                    }}
                                    className="text-[11px] px-2 py-1 rounded-lg border border-border text-text-secondary hover:bg-fill transition-colors"
                                >
                                    {selectedChatIds.size > 0 ? t('deselectAll') : t('selectAll')}
                                </button>
                                <button
                                    type="button"
                                    disabled={selectedChatIds.size === 0}
                                    onClick={() => void handleBulkArchive(!Array.from(selectedChatIds).every(id => chats.find(c => c.id === id)?.isArchived))}
                                    className="text-[11px] px-2 py-1 rounded-lg border border-border text-text-secondary hover:bg-fill transition-colors disabled:opacity-40"
                                >
                                    {Array.from(selectedChatIds).every(id => chats.find(c => c.id === id)?.isArchived)
                                        ? t('unarchiveSelected')
                                        : t('archiveSelected')}
                                </button>
                                <button
                                    type="button"
                                    disabled={selectedChatIds.size === 0}
                                    onClick={() => void handleBulkDelete()}
                                    className="text-[11px] px-2 py-1 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                                >
                                    {t('deleteSelected')}
                                </button>
                            </div>
                        )}
                        <div className="space-y-px">
                        {(() => {
                            const q = searchQuery.toLowerCase().trim()
                            const filtered = q
                                ? chats.filter((c) => c.title.toLowerCase().includes(q))
                                : chats

                            if (filtered.length === 0 && q) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-8 text-center">
                                        <p className="text-xs text-text-tertiary">{t('noMatchingChats')}</p>
                                    </div>
                                )
                            }

                            if (filtered.length === 0) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-10 h-10 rounded-xl bg-fill flex items-center justify-center mb-3">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </div>
                                        <p className="text-xs text-text-tertiary">{t('noChatsYet')}</p>
                                        <p className="text-[11px] text-text-quaternary mt-0.5">{t('startNewConversation')}</p>
                                    </div>
                                )
                            }

                            // ── Compute groups ────────────────────────────────────
                            const now = new Date()
                            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
                            const startOfYesterday = startOfToday - 24 * 3600 * 1000
                            const startOfPast7 = startOfToday - 7 * 24 * 3600 * 1000
                            const sortedAll = [...filtered].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
                            const archived = sortedAll.filter((c) => c.isArchived)
                            const live = sortedAll.filter((c) => !c.isArchived)
                            const pinned = live.filter((c) => c.isPinned)
                            const unpinned = live.filter((c) => !c.isPinned)
                            const today: typeof unpinned = []
                            const yesterday: typeof unpinned = []
                            const past7: typeof unpinned = []
                            const earlier: typeof unpinned = []
                            for (const c of unpinned) {
                                const ts = c.updatedAt ?? c.createdAt
                                if (ts >= startOfToday) today.push(c)
                                else if (ts >= startOfYesterday) yesterday.push(c)
                                else if (ts >= startOfPast7) past7.push(c)
                                else earlier.push(c)
                            }

                            // When searching, flatten and skip group chrome.
                            const searching = !!q

                            const renderChatRow = (chat: typeof sortedAll[number]) => {
                                const running = !!generatingBySession[chat.id]
                                const lastMsgs = messagesBySession[chat.id]
                                const lastAssistant = lastMsgs ? [...lastMsgs].reverse().find((m) => m.role === 'assistant') : undefined
                                const needsConfirm = !!lastAssistant?.activityLog?.some(
                                    (a) => a.type === 'tool_confirm' && a.confirmStatus === 'pending'
                                )
                                const isSelected = selectedChatIds.has(chat.id)

                                if (selectMode) {
                                    return (
                                        <div
                                            key={chat.id}
                                            onClick={() => toggleSelectChat(chat.id)}
                                            className={cn(
                                                'group relative flex items-center gap-2 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150 text-[13px]',
                                                isSelected
                                                    ? 'bg-primary-mint/10 text-text'
                                                    : 'text-text-secondary hover:bg-sidebar-hover'
                                            )}
                                        >
                                            {isSelected
                                                ? <CheckSquare size={14} className="shrink-0 text-primary-mint" />
                                                : <Square size={14} className="shrink-0 text-text-quaternary" />
                                            }
                                            <span className="flex-1 truncate">{chat.title}</span>
                                        </div>
                                    )
                                }

                                return (
                                    <div
                                        key={chat.id}
                                        onClick={() => { selectChat(chat.id); navigate('/chat'); onNavigate?.() }}
                                        onContextMenu={(e) => handleChatRightClick(e, chat.id)}
                                        onTouchStart={(e) => handleTouchStart(e, chat.id)}
                                        onTouchEnd={handleTouchEnd}
                                        onTouchMove={handleTouchMove}
                                        className={cn(
                                            'group relative flex items-center gap-2 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150 text-[13px]',
                                            activeChatId === chat.id
                                                ? 'bg-sidebar-active text-text font-medium'
                                                : 'text-text-secondary hover:bg-sidebar-hover'
                                        )}
                                    >
                                        {/* Status icon: running > needsConfirm > pinned > default dot */}
                                        {running ? (
                                            <Loader2 size={12} className="shrink-0 text-primary-mint animate-spin" aria-label={t('chatStatusRunning')} />
                                        ) : needsConfirm ? (
                                            <AlertTriangle size={12} className="shrink-0 text-warning" aria-label={t('chatStatusNeedsConfirm')} />
                                        ) : chat.isPinned ? (
                                            <Pin size={11} className="shrink-0 text-primary-mint" fill="currentColor" />
                                        ) : (
                                            <span aria-hidden className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-text-quaternary/70" />
                                        )}
                                        <span className="flex-1 truncate">
                                            {searching ? <HighlightText text={chat.title} query={q} /> : chat.title}
                                        </span>
                                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity duration-150">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handlePin(chat.id) }}
                                                className="p-1 hover:bg-fill rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-secondary"
                                                title={chat.isPinned ? t('unpin') : t('pin')}
                                            >
                                                <Pin size={12} fill={chat.isPinned ? 'currentColor' : 'none'} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setContextMenu({ id: chat.id, x: e.clientX, y: e.clientY }) }}
                                                className="p-1 hover:bg-fill rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-secondary"
                                            >
                                                <MoreHorizontal size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            }

                            if (searching) {
                                return sortedAll.map(renderChatRow)
                            }

                            type GroupKey = 'pinned' | 'today' | 'yesterday' | 'past7' | 'earlier' | 'archived'
                            const groups: { key: GroupKey; label: string; items: typeof sortedAll; defaultCollapsed?: boolean }[] = [
                                { key: 'pinned', label: t('chatGroupPinned'), items: pinned },
                                { key: 'today', label: t('chatGroupToday'), items: today },
                                { key: 'yesterday', label: t('chatGroupYesterday'), items: yesterday },
                                { key: 'past7', label: t('chatGroupPast7Days'), items: past7 },
                                { key: 'earlier', label: t('chatGroupEarlier'), items: earlier },
                                { key: 'archived', label: t('chatGroupArchived'), items: archived, defaultCollapsed: true },
                            ]

                            return (
                                <>
                                    {groups.map((g) => {
                                        if (g.items.length === 0) return null
                                        const collapsed = collapsedGroups[g.key] ?? !!g.defaultCollapsed
                                        return (
                                            <div key={g.key} className="mb-1">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleGroup(g.key)}
                                                    className="w-full flex items-center px-2.5 py-1.5 text-[12px] font-medium text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                                                >
                                                    <span className="flex-1 text-left">{g.label}</span>
                                                    <span className="text-text-quaternary font-normal text-[11px]">{g.items.length}</span>
                                                </button>
                                                {!collapsed && (
                                                    <div className="space-y-px">
                                                        {g.items.map(renderChatRow)}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </>
                            )
                        })()}
                        </div>
                    </div>
                </>
            )}

            {/* ── Articles Tab ── */}
            {activeTab === 'articles' && (
                <>
                    {/* Header */}
                    <div className="px-3 pt-2.5 pb-1.5 flex items-center border-b border-border">
                        <p className="text-[11px] font-medium text-text-quaternary uppercase tracking-wider flex-1">{t('notebook')}</p>
                        <button
                            onClick={() => setAddingNotebook(true)}
                            className="p-1 rounded hover:bg-fill transition-colors text-text-quaternary hover:text-text-secondary"
                            title={t('addNotebook')}
                        >
                            <Plus size={13} />
                        </button>
                    </div>
                    {/* Notebooks + articles list */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1.5 space-y-px">
                        {notebooks.map((nb) => (
                            <div key={nb}>
                                <div
                                    className="group relative flex items-center rounded-lg transition-all duration-150 hover:bg-sidebar-hover"
                                    onContextMenu={(e) => handleNotebookContextMenu(e, nb)}
                                >
                                    <button
                                        onClick={() => { navigate(`/notebook/${encodeURIComponent(nb)}`); onNavigate?.(); void toggleNotebookExpand(nb) }}
                                        className="flex-1 flex items-center gap-2 px-2.5 py-[7px] text-[13px] cursor-pointer min-w-0 text-text-secondary"
                                    >
                                        {loadingNbs.has(nb)
                                            ? <Loader2 size={13} className="shrink-0 text-text-quaternary animate-spin" />
                                            : expandedNbs.has(nb)
                                            ? <ChevronDown size={13} className="shrink-0 text-text-quaternary" />
                                            : <ChevronRight size={13} className="shrink-0 text-text-quaternary" />
                                        }
                                        <span className="truncate flex-1 text-left">{nb}</span>
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); navigate(`/notebook/article/new?notebook=${encodeURIComponent(nb)}`); onNavigate?.() }}
                                        className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-fill transition-all text-text-quaternary hover:text-text-secondary"
                                        title={t('newNote')}
                                    >
                                        <Plus size={12} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setNotebookSettingsFor(nb) }}
                                        className="opacity-0 group-hover:opacity-100 shrink-0 mr-0.5 p-0.5 rounded hover:bg-fill transition-all text-text-quaternary hover:text-text-secondary"
                                        title="笔记本设置"
                                    >
                                        <Settings size={12} />
                                    </button>
                                </div>
                                {expandedNbs.has(nb) && (
                                    <div className="ml-5 space-y-px border-l border-border pl-2 pb-1">
                                        {(nbArticles[nb] ?? []).length === 0 && !loadingNbs.has(nb) ? (
                                            <p className="px-2.5 py-1.5 text-xs text-text-quaternary italic">{t('noChatsYet')}</p>
                                        ) : applySortToEntries(nbArticles[nb] ?? [], (nbSortState[nb] ?? getNotebookSort(nb)) as 'default' | 'date-desc' | 'date-asc' | 'title').map((article) => (
                                            <Link
                                                key={article.id}
                                                to={`/notebook/${encodeURIComponent(nb)}?article=${encodeURIComponent(article.id)}`}
                                                onClick={onNavigate}
                                                className={cn(
                                                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150 min-w-0',
                                                    location.pathname === `/notebook/${encodeURIComponent(nb)}` && location.search.includes(`article=${encodeURIComponent(article.id)}`)
                                                        ? 'bg-sidebar-active text-text font-medium'
                                                        : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                                                )}
                                            >
                                                <span className="truncate" title={article.title}>{article.title}</span>
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {addingNotebook && (
                            <div className="flex items-center gap-1 px-2.5 py-1">
                                <input
                                    autoFocus
                                    type="text"
                                    value={newNotebookName}
                                    onChange={(e) => setNewNotebookName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newNotebookName.trim()) {
                                            commitNewNotebook()
                                        } else if (e.key === 'Escape') {
                                            cancelNotebookCommitRef.current = true
                                            setAddingNotebook(false)
                                            setNewNotebookName('')
                                        }
                                    }}
                                    onBlur={commitNewNotebook}
                                    placeholder={t('notebookNamePlaceholder')}
                                    className="flex-1 text-xs bg-transparent border-b border-primary-mint/50 focus:outline-none py-0.5 text-text placeholder:text-text-quaternary"
                                />
                            </div>
                        )}
                    </div>
                </>
            )}


            {/* Footer */}

            <div className="mt-auto border-t border-border relative">
                {/* Trash button row */}
                <div className="flex items-center px-3 py-1.5 gap-1">
                    <button
                        onClick={() => setTrashOpen(!trashOpen)}
                        className={cn(
                            'flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer flex-1',
                            trashOpen
                                ? 'bg-fill-secondary text-text-secondary'
                                : 'text-text-quaternary hover:bg-fill-secondary/60 hover:text-text-secondary',
                        )}
                    >
                        <Trash2 size={13} />
                        {t('trash')}
                    </button>
                </div>

                <div
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-sidebar-hover transition-colors cursor-pointer mx-1 my-1 rounded-lg"
                >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-mint/40 to-primary-mint/15 flex items-center justify-center text-primary-mint text-xs font-bold shrink-0">
                        {me?.displayName?.[0]?.toUpperCase() ?? 'N'}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[13px] font-medium truncate leading-tight">{me?.displayName ?? 'Neo Web'}</span>
                        {me?.userId && (
                            <span className="text-[11px] text-text-tertiary truncate leading-tight">{me.userId}</span>
                        )}
                    </div>
                    <MoreHorizontal size={14} className="text-text-quaternary shrink-0" />
                </div>

                {menuOpen && (
                    <div
                        className="absolute bottom-full left-2 right-2 glass border border-border rounded-xl py-1.5 z-50 animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Theme picker */}
                        <div className="px-3 py-2">
                            <p className="text-[11px] text-text-tertiary mb-2 flex items-center gap-1.5 font-medium">
                                <Palette size={11} /> {t('theme')}
                            </p>
                            <div className="flex gap-1.5">
                                {THEMES.map((th) => (
                                    <button
                                        key={th.value}
                                        onClick={() => { setTheme(th.value); setMenuOpen(false) }}
                                        className={cn(
                                            'flex-1 py-1.5 rounded-lg text-[11px] transition-all duration-200 border cursor-pointer',
                                            theme === th.value
                                                ? 'bg-primary-mint/15 border-primary-mint/30 text-text font-medium'
                                                : 'border-border hover:bg-fill-secondary text-text-secondary hover:text-text'
                                        )}
                                    >
                                        {t(th.labelKey)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Language picker */}
                        <div className="px-3 py-2">
                            <p className="text-[11px] text-text-tertiary mb-2 flex items-center gap-1.5 font-medium">
                                <Globe size={11} /> {t('language')}
                            </p>
                            <div className="flex gap-1.5">
                                {LOCALE_OPTIONS.map((lo) => (
                                    <button
                                        key={lo.value}
                                        onClick={() => { setLocale(lo.value); setMenuOpen(false) }}
                                        className={cn(
                                            'flex-1 py-1.5 rounded-lg text-[11px] transition-all duration-200 border cursor-pointer',
                                            locale === lo.value
                                                ? 'bg-primary-mint/15 border-primary-mint/30 text-text font-medium'
                                                : 'border-border hover:bg-fill-secondary text-text-secondary hover:text-text'
                                        )}
                                    >
                                        {lo.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="border-t border-border mx-2 my-1" />

                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".md,.markdown,.json,text/markdown,application/json"
                            className="hidden"
                            onChange={(e) => void handleImportChat(e.target.files?.[0])}
                        />
                        <button
                            onClick={() => importInputRef.current?.click()}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:bg-fill-secondary hover:text-text transition-colors rounded-lg mx-0 cursor-pointer"
                        >
                            <Upload size={14} />
                            {t('importChat')}
                        </button>

                        <button
                            onClick={handleInitializeWorkspace}
                            disabled={initializingWorkspace || !me?.userId}
                            className={cn(
                                'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors rounded-lg mx-0 cursor-pointer',
                                initializingWorkspace || !me?.userId
                                    ? 'text-text-quaternary cursor-not-allowed opacity-60'
                                    : 'text-text-secondary hover:bg-fill-secondary hover:text-text'
                            )}
                        >
                            <Plus size={14} />
                            {initializingWorkspace ? t('workspaceInitLoading') : t('initializeWorkspace')}
                        </button>

                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/8 transition-colors rounded-lg mx-0 cursor-pointer"
                        >
                            <LogOut size={14} />
                            {t('signOut')}
                        </button>
                    </div>
                )}
            </div>

            {/* Right-click / long-press context menu */}
            {contextMenu && (
                <div
                    className="fixed glass border border-border rounded-xl py-1.5 z-50 min-w-[150px] animate-slide-up"
                    style={{
                        top: Math.min(contextMenu.y, window.innerHeight - CONTEXT_MENU_HEIGHT_BUFFER),
                        left: Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH_BUFFER),
                        boxShadow: 'var(--shadow-float)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => { handlePin(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary transition-colors cursor-pointer"
                    >
                        {chats.find(c => c.id === contextMenu.id)?.isPinned
                            ? <><PinOff size={13} /> {t('unpin')}</>
                            : <><Pin size={13} /> {t('pin')}</>}
                    </button>
                    <button
                        onClick={() => { handleRename(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary transition-colors cursor-pointer"
                    >
                        <Pencil size={13} /> {t('rename')}
                    </button>
                    {(() => {
                        const c = chats.find((x) => x.id === contextMenu.id)
                        const archived = !!c?.isArchived
                        return (
                            <button
                                onClick={() => { handleArchive(contextMenu.id, !archived); setContextMenu(null) }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {archived
                                    ? <><ArchiveRestore size={13} /> {t('unarchive')}</>
                                    : <><Archive size={13} /> {t('archive')}</>}
                            </button>
                        )
                    })()}
                    <button
                        onClick={() => { handleDelete(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/8 transition-colors cursor-pointer"
                    >
                        <Trash2 size={13} /> {t('delete')}
                    </button>
                </div>
            )}


            {/* Delete confirmation dialog */}
            {confirmDelete && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setConfirmDelete(null)}>
                    <div
                        className="glass border border-border rounded-2xl p-5 w-[320px] animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold mb-2">{t('deleteChat')}</h3>
                        <p className="text-xs text-text-secondary mb-5 leading-relaxed">
                            {t('deleteChatConfirm')}
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-3.5 py-1.5 text-xs rounded-lg border border-border hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={confirmDeleteChat}
                                className="px-3.5 py-1.5 text-xs rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors cursor-pointer"
                            >
                                {t('delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rename dialog */}
            {renamingChat && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setRenamingChat(null)}>
                    <div
                        className="glass border border-border rounded-2xl p-5 w-[320px] animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold mb-3">{t('renameChat')}</h3>
                        <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmRename(); if (e.key === 'Escape') setRenamingChat(null) }}
                            className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-mint/30 focus:border-primary-mint/40 transition-all mb-4 select-text"
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setRenamingChat(null)}
                                className="px-3.5 py-1.5 text-xs rounded-lg border border-border hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={confirmRename}
                                className="px-3.5 py-1.5 text-xs rounded-lg bg-primary-mint text-white hover:bg-primary-mint/90 transition-colors cursor-pointer"
                            >
                                {t('save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notebook settings modal */}
            {notebookSettingsFor && (
                <NotebookSettingsModal
                    notebook={notebookSettingsFor}
                    onClose={() => setNotebookSettingsFor(null)}
                    onSortChange={(s) => setNbSortState(prev => ({ ...prev, [notebookSettingsFor!]: s }))}
                    onRenamed={(newName) => {
                        setNotebooks(prev => prev.map(n => n === notebookSettingsFor ? newName : n))
                        if (location.pathname === `/notebook/${encodeURIComponent(notebookSettingsFor)}`) {
                            navigate(`/notebook/${encodeURIComponent(newName)}`)
                        }
                        setNotebookSettingsFor(null)
                    }}
                />
            )}

            {/* Notebook context menu */}
            {notebookContextMenu && (
                <div
                    className="fixed z-[200] w-40 rounded-xl border border-border bg-bg-container shadow-lg py-1 overflow-hidden text-[12px]"
                    style={{ top: notebookContextMenu.y, left: notebookContextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => { setRenamingNotebook(notebookContextMenu.name); setNotebookRenameValue(notebookContextMenu.name); setNotebookContextMenu(null) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-fill-secondary transition-colors text-left text-text"
                    >
                        <Pencil size={12} className="text-text-tertiary" />{t('renameNotebook')}
                    </button>
                    <button
                        onClick={() => { setConfirmDeleteNotebook(notebookContextMenu.name); setNotebookContextMenu(null) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-fill-secondary transition-colors text-left text-destructive"
                    >
                        <Trash2 size={12} />{t('deleteNotebook')}
                    </button>
                </div>
            )}

            {/* Notebook delete confirmation dialog */}
            {confirmDeleteNotebook && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setConfirmDeleteNotebook(null)}>
                    <div
                        className="glass border border-border rounded-2xl p-5 w-[320px] animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold mb-2">{t('deleteNotebook')}</h3>
                        <p className="text-xs text-text-secondary mb-5 leading-relaxed">
                            {t('deleteNotebookConfirm')}
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmDeleteNotebook(null)}
                                className="px-3.5 py-1.5 text-xs rounded-lg border border-border hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={confirmDeleteNotebookAction}
                                className="px-3.5 py-1.5 text-xs rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors cursor-pointer"
                            >
                                {t('delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notebook rename dialog */}
            {renamingNotebook && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setRenamingNotebook(null)}>
                    <div
                        className="glass border border-border rounded-2xl p-5 w-[320px] animate-slide-up"
                        style={{ boxShadow: 'var(--shadow-float)' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-sm font-semibold mb-3">{t('renameNotebook')}</h3>
                        <input
                            ref={notebookRenameInputRef}
                            type="text"
                            value={notebookRenameValue}
                            onChange={(e) => setNotebookRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirmRenameNotebook(); if (e.key === 'Escape') setRenamingNotebook(null) }}
                            placeholder={t('notebookNewNamePlaceholder')}
                            className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-mint/30 focus:border-primary-mint/40 transition-all mb-4 select-text"
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setRenamingNotebook(null)}
                                className="px-3.5 py-1.5 text-xs rounded-lg border border-border hover:bg-fill-secondary transition-colors cursor-pointer"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={confirmRenameNotebook}
                                className="px-3.5 py-1.5 text-xs rounded-lg bg-primary-mint text-white hover:bg-primary-mint/90 transition-colors cursor-pointer"
                            >
                                {t('save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Trash panel */}
            {trashOpen && (
                <TrashPanel
                    onClose={() => setTrashOpen(false)}
                />
            )}
        </div>
    )
}
