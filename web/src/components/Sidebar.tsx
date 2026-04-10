import React from 'react'
import { Plus, Pin, Trash2, MoreHorizontal, Palette, LogOut } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { logout, fetchMe, type MeInfo } from '../api'
import type { Theme } from '../types'

const THEMES: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'classic-dark', label: 'Classic Dark' },
]

export const Sidebar: React.FC = () => {
    const { chats, activeChatId, selectChat, createChat, deleteChat, pinChat, setTheme, theme } = useAppStore()
    const [menuOpen, setMenuOpen] = React.useState(false)
    const [contextMenu, setContextMenu] = React.useState<{ id: string; x: number; y: number } | null>(null)
    const [me, setMe] = React.useState<MeInfo | null>(null)

    React.useEffect(() => {
        fetchMe().then(setMe).catch(() => {})
    }, [])

    const handleLogout = () => {
        logout().finally(() => window.location.reload())
    }

    const handleChatRightClick = (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        setContextMenu({ id, x: e.clientX, y: e.clientY })
    }

    // Close context menu on click outside
    React.useEffect(() => {
        if (!contextMenu) return
        const close = () => setContextMenu(null)
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [contextMenu])

    return (
        <div className="flex flex-col h-full bg-bg-container border-r border-border w-full overflow-hidden select-none">
            {/* Header */}
            <div className="px-3 pt-4 pb-2">
                <button
                    onClick={createChat}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-fill-secondary hover:bg-fill border border-border rounded-lg text-text transition-colors text-sm font-medium"
                >
                    <Plus size={15} />
                    <span>New Chat</span>
                </button>
            </div>

            {/* Chat list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1 space-y-0.5">
                {chats.map((chat) => (
                    <div
                        key={chat.id}
                        onClick={() => selectChat(chat.id)}
                        onContextMenu={(e) => handleChatRightClick(e, chat.id)}
                        className={cn(
                            'group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm',
                            activeChatId === chat.id
                                ? 'bg-primary-mint/10 text-text font-medium'
                                : 'text-text-secondary hover:bg-fill-secondary'
                        )}
                    >
                        {chat.isPinned && <Pin size={11} className="shrink-0 text-primary-mint" fill="currentColor" />}
                        <span className="flex-1 truncate">{chat.title}</span>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                            <button
                                onClick={(e) => { e.stopPropagation(); pinChat(chat.id) }}
                                className="p-1 hover:bg-fill rounded"
                            >
                                <Pin size={12} fill={chat.isPinned ? 'currentColor' : 'none'} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setContextMenu({ id: chat.id, x: e.clientX, y: e.clientY }) }}
                                className="p-1 hover:bg-fill rounded"
                            >
                                <MoreHorizontal size={12} />
                            </button>
                        </div>
                    </div>
                ))}

                {chats.length === 0 && (
                    <p className="text-xs text-text-quaternary text-center py-8">No chats yet</p>
                )}
            </div>

            {/* Footer */}
            <div className="mt-auto border-t border-border relative">
                <div
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-fill-secondary cursor-pointer transition-colors"
                >
                    <div className="w-7 h-7 rounded-full bg-primary-mint/20 border border-primary-mint/30 flex items-center justify-center text-primary-mint text-xs font-bold shrink-0">
                        {me?.displayName?.[0]?.toUpperCase() ?? 'N'}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium truncate leading-tight">{me?.displayName ?? 'Neo Web'}</span>
                        {me?.userId && (
                            <span className="text-[11px] text-text-tertiary truncate leading-tight">{me.userId}</span>
                        )}
                    </div>
                    <MoreHorizontal size={14} className="text-text-tertiary shrink-0" />
                </div>

                {menuOpen && (
                    <div
                        className="absolute bottom-full left-2 right-2 bg-bg-elevated border border-border rounded-xl shadow-xl py-1 z-50 animate-slide-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Theme picker */}
                        <div className="px-3 py-2">
                            <p className="text-[11px] text-text-tertiary mb-1.5 flex items-center gap-1.5">
                                <Palette size={11} /> Theme
                            </p>
                            <div className="flex gap-1.5">
                                {THEMES.map((t) => (
                                    <button
                                        key={t.value}
                                        onClick={() => { setTheme(t.value); setMenuOpen(false) }}
                                        className={cn(
                                            'flex-1 py-1 rounded-md text-[11px] transition-colors border',
                                            theme === t.value
                                                ? 'bg-primary-mint/20 border-primary-mint/40 text-text font-medium'
                                                : 'border-border hover:bg-fill-secondary text-text-secondary'
                                        )}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="border-t border-border mx-2 my-1" />

                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-fill-secondary transition-colors"
                        >
                            <LogOut size={14} />
                            Sign out
                        </button>
                    </div>
                )}
            </div>

            {/* Right-click context menu */}
            {contextMenu && (
                <div
                    className="fixed bg-bg-elevated border border-border rounded-xl shadow-xl py-1 z-50 min-w-[140px] animate-slide-up"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => { pinChat(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary transition-colors"
                    >
                        <Pin size={13} /> Pin / Unpin
                    </button>
                    <button
                        onClick={() => { deleteChat(contextMenu.id); setContextMenu(null) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-fill-secondary transition-colors"
                    >
                        <Trash2 size={13} /> Delete
                    </button>
                </div>
            )}

            {/* Notebook link */}
            <div className="px-2 pb-2 border-t border-border pt-2">
                <Link
                    to="/notebook"
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-tertiary hover:text-text hover:bg-fill-secondary rounded-lg transition-colors"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                    <span>Notebook</span>
                </Link>
            </div>
        </div>
    )
}
