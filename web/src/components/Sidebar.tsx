import React from 'react'
import { Pin, PinOff, Archive, ArchiveRestore, Loader2, AlertTriangle, Trash2, MoreHorizontal, Palette, LogOut, Search, X, Pencil, Globe, BookOpen, ChevronDown, ChevronRight, MessageSquarePlus, PanelLeftClose, Plus, Settings } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { logout, fetchMe, fetchSessions, patchSession, deleteSessionApi, notebookListNotebooks, initializeWorkspace, type MeInfo } from '../api'
import { useT, LOCALE_OPTIONS } from '../i18n'
import { toast } from './Toast'
import type { Theme } from '../types'

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
    const [contextMenu, setContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
    const [me, setMe] = React.useState<MeInfo | null>(null)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
    const [renamingChat, setRenamingChat] = React.useState<{ id: string; title: string } | null>(null)
    const [renameValue, setRenameValue] = React.useState('')
    const [initializingWorkspace, setInitializingWorkspace] = React.useState(false)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const renameInputRef = React.useRef<HTMLInputElement>(null)
    const longPressTimerRef = React.useRef<number | null>(null)

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
            }))))
            .catch(() => {})
    }, [])

    // Load notebooks when section is expanded
    React.useEffect(() => {
        if (!notebookOpen) return
        notebookListNotebooks().then(setNotebooks).catch(() => {})
    }, [notebookOpen])

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

    const handleChatRightClick = (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        setContextMenu({ id, x: e.clientX, y: e.clientY })
    }

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
            {/* Logo + Search */}
            <div className="px-3 pt-3.5 pb-2 space-y-2.5">
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

                {/* Search box */}
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
            </div>

            {/* Navigation */}
            <div className="px-3 py-1.5 space-y-0.5 border-b border-border">
                <button
                    onClick={() => { createChat(); navigate('/chat'); onNavigate?.() }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150 cursor-pointer"
                >
                    <MessageSquarePlus size={15} className="shrink-0 text-text-tertiary" />
                    <span>{t('newChat')}</span>
                </button>

                {/* Notebook collapsible */}
                <div>
                    <button
                        onClick={() => setNotebookOpen(!notebookOpen)}
                        className={cn(
                            'w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition-all duration-150 cursor-pointer',
                            location.pathname.startsWith('/notebook')
                                ? 'bg-sidebar-active text-text font-medium'
                                : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                        )}
                    >
                        <BookOpen size={15} className="shrink-0 text-text-tertiary" />
                        <span className="flex-1 text-left">{t('notebook')}</span>
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setNotebookOpen(true); setAddingNotebook(true) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setNotebookOpen(true); setAddingNotebook(true) } }}
                            className="p-0.5 rounded hover:bg-fill transition-colors text-text-quaternary hover:text-text-secondary"
                            title={t('addNotebook')}
                        >
                            <Plus size={12} />
                        </span>
                        {notebookOpen ? <ChevronDown size={13} className="text-text-quaternary" /> : <ChevronRight size={13} className="text-text-quaternary" />}
                    </button>
                    {notebookOpen && (
                        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border pl-2">
                            {notebooks.map((nb) => (
                                <div key={nb} className="group relative flex items-center">
                                    <Link
                                        to={`/notebook/${encodeURIComponent(nb)}`}
                                        onClick={onNavigate}
                                        className={cn(
                                            'flex-1 flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150 min-w-0',
                                            location.pathname === `/notebook/${encodeURIComponent(nb)}`
                                                ? 'bg-sidebar-active text-text font-medium'
                                                : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                                        )}
                                    >
                                        <span className="w-3 h-3 shrink-0 flex items-center justify-center text-text-quaternary text-[10px]">#</span>
                                        <span className="truncate">{nb}</span>
                                    </Link>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); navigate(`/notebook/article/new?notebook=${encodeURIComponent(nb)}`); onNavigate?.() }}
                                        className="opacity-0 group-hover:opacity-100 shrink-0 mr-1 p-0.5 rounded hover:bg-fill transition-all text-text-quaternary hover:text-text-secondary"
                                        title={t('newNote')}
                                    >
                                        <Plus size={12} />
                                    </button>
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
                                                const name = newNotebookName.trim()
                                                if (!notebooks.includes(name)) setNotebooks([...notebooks, name])
                                                navigate(`/notebook/article/new?notebook=${encodeURIComponent(name)}`)
                                                setNewNotebookName('')
                                                setAddingNotebook(false)
                                                onNavigate?.()
                                            } else if (e.key === 'Escape') {
                                                setAddingNotebook(false)
                                                setNewNotebookName('')
                                            }
                                        }}
                                        onBlur={() => { setAddingNotebook(false); setNewNotebookName('') }}
                                        placeholder={t('notebookNamePlaceholder')}
                                        className="flex-1 text-xs bg-transparent border-b border-primary-mint/50 focus:outline-none py-0.5 text-text placeholder:text-text-quaternary"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <Link
                    to="/settings"
                    onClick={onNavigate}
                    className={cn(
                        'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition-all duration-150',
                        location.pathname === '/settings'
                            ? 'bg-sidebar-active text-text font-medium'
                            : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                    )}
                >
                    <Settings size={15} className="shrink-0 text-text-tertiary" />
                    <span>{t('settings')}</span>
                </Link>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2">
                <p className="text-[11px] font-medium text-text-quaternary uppercase tracking-wider px-2.5 mb-1.5">{t('chats') ?? 'Chats'}</p>
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
                                <span className="flex-1 truncate">{chat.title}</span>
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

            {/* Footer */}
            <div className="mt-auto border-t border-border relative">
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
        </div>
    )
}
