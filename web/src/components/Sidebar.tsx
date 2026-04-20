import React from 'react'
import { Plus, Pin, Trash2, MoreHorizontal, Palette, LogOut, Search, X, Pencil, Globe, BookOpen, Droplets, ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { logout, fetchMe, fetchSessions, patchSession, deleteSessionApi, type MeInfo } from '../api'
import { useT, LOCALE_OPTIONS } from '../i18n'
import type { Theme } from '../types'

const THEMES: { value: Theme; labelKey: 'themeLight' | 'themeDark' | 'themeClassicDark' }[] = [
    { value: 'light', labelKey: 'themeLight' },
    { value: 'dark', labelKey: 'themeDark' },
    { value: 'classic-dark', labelKey: 'themeClassicDark' },
]

const LONG_PRESS_MOVE_THRESHOLD = 10
const CONTEXT_MENU_HEIGHT_BUFFER = 120
const CONTEXT_MENU_WIDTH_BUFFER = 170

export const Sidebar: React.FC = () => {
    const { chats, activeChatId, selectChat, createChat, deleteChat, pinChat, renameChat, setTheme, theme, setChats, locale, setLocale } = useAppStore()
    const t = useT()
    const location = useLocation()
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [appsOpen, setAppsOpen] = React.useState(false)
    const [contextMenu, setContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
    const [me, setMe] = React.useState<MeInfo | null>(null)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
    const [renamingChat, setRenamingChat] = React.useState<{ id: string; title: string } | null>(null)
    const [renameValue, setRenameValue] = React.useState('')
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
                createdAt: r.createdAt,
            }))))
            .catch(() => {})
    }, [])

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

    const handleLogout = () => {
        logout().finally(() => window.location.reload())
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
            {/* Header */}
            <div className="px-3 pt-4 pb-2 space-y-2">


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

            {/* Navigation: Notebook & Apps */}
            <div className="px-3 py-1.5 space-y-0.5 border-b border-border">
                <button
                    onClick={createChat}
                    className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-text transition-all duration-150 text-[13px] font-medium hover:bg-sidebar-hover active:scale-[0.98] cursor-pointer"
                >
                    <div className="w-5 h-5 rounded-md bg-primary-mint/15 flex items-center justify-center">
                        <Plus size={13} strokeWidth={2.5} className="text-primary-mint" />
                    </div>
                    <span>{t('newChat')}</span>
                </button>
                <Link
                    to="/notebook"
                    className={cn(
                        'flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition-all duration-150',
                        location.pathname.startsWith('/notebook')
                            ? 'bg-sidebar-active text-text font-medium'
                            : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                    )}
                >
                    <BookOpen size={15} className="shrink-0 text-text-tertiary" />
                    <span>{t('notebook')}</span>
                </Link>
                <div>
                    <button
                        onClick={() => setAppsOpen(!appsOpen)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-text-secondary hover:bg-sidebar-hover hover:text-text transition-all duration-150 cursor-pointer"
                    >
                        <LayoutGrid size={15} className="shrink-0 text-text-tertiary" />
                        <span className="flex-1 text-left">{t('apps')}</span>
                        {appsOpen ? <ChevronDown size={13} className="text-text-quaternary" /> : <ChevronRight size={13} className="text-text-quaternary" />}
                    </button>
                    {appsOpen && (
                        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border pl-2">
                            <Link
                                to="/puzzle"
                                className={cn(
                                    'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-150',
                                    location.pathname === '/puzzle'
                                        ? 'bg-sidebar-active text-text font-medium'
                                        : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                                )}
                            >
                                <Droplets size={13} className="shrink-0" />
                                <span>{t('puzzle')}</span>
                            </Link>
                        </div>
                    )}
                </div>
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

                    return filtered.map((chat) => (
                        <div
                            key={chat.id}
                            onClick={() => selectChat(chat.id)}
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
                            {chat.isPinned && <Pin size={11} className="shrink-0 text-primary-mint" fill="currentColor" />}
                            <span className="flex-1 truncate">{chat.title}</span>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity duration-150">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handlePin(chat.id) }}
                                    className="p-1 hover:bg-fill rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-secondary"
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
                    ))
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
                        <Pin size={13} /> {t('pinUnpin')}
                    </button>
                    <button
                        onClick={() => { handleRename(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary transition-colors cursor-pointer"
                    >
                        <Pencil size={13} /> {t('rename')}
                    </button>
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
