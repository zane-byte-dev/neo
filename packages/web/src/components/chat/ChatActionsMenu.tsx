import React from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Download, MoreHorizontal, PenLine, Pin, PinOff, Trash2, X } from 'lucide-react'
import {
    deleteSessionApi,
    notebookImportSource,
    notebookListNotebooks,
    patchSession,
} from '../../api'
import { t } from '../../i18n'
import { useAppStore } from '../../stores/useAppStore'
import type { Message } from '../../types'
import { confirm as confirmDialog } from '../ConfirmDialog'
import { toast } from '../Toast'

const MAX_EXPORT_FILENAME_LENGTH = 50

function exportChatAsMarkdown(title: string, messages: Message[]) {
    const lines = [`# ${title}\n`]
    const fmt = (ts: number) => new Date(ts).toLocaleString()
    for (const msg of messages) {
        const role = msg.role === 'user' ? t('you') : t('neo')
        const ts = msg.timestamp ? ` *(${fmt(msg.timestamp)})*` : ''
        lines.push(`### ${role}${ts}\n`)
        if (msg.thinking) {
            lines.push(`> 💭 ${msg.thinking.replace(/\n/g, '\n> ')}\n`)
        }
        if (msg.content) lines.push(msg.content + '\n')
        if (msg.activityLog?.length) {
            for (const act of msg.activityLog) {
                if (act.type === 'tool_call') {
                    lines.push(`\n> **[Tool call]** \`${act.toolName}\``)
                    if (act.args && Object.keys(act.args).length > 0) {
                        lines.push(`\n> \`\`\`json\n> ${JSON.stringify(act.args, null, 2).replace(/\n/g, '\n> ')}\n> \`\`\``)
                    }
                    lines.push('')
                } else if (act.type === 'tool_result') {
                    lines.push(`> **[Tool result]** \`${act.toolName}\``)
                    if (act.result) {
                        const preview = act.truncated ? act.result + '\n*(truncated)*' : act.result
                        lines.push(`> \`\`\`\n> ${preview.replace(/\n/g, '\n> ')}\n> \`\`\`\n`)
                    }
                }
            }
        }
        if (msg.parts?.length) {
            for (const part of msg.parts) {
                if (part.type !== 'activity') continue
                const act = part.item
                if (act.type === 'tool_call') {
                    lines.push(`\n> **[Tool call]** \`${act.toolName}\``)
                    if (act.args && Object.keys(act.args).length > 0) {
                        lines.push(`\n> \`\`\`json\n> ${JSON.stringify(act.args, null, 2).replace(/\n/g, '\n> ')}\n> \`\`\``)
                    }
                    lines.push('')
                } else if (act.type === 'tool_result') {
                    lines.push(`> **[Tool result]** \`${act.toolName}\``)
                    if (act.result) {
                        const preview = act.truncated ? act.result + '\n*(truncated)*' : act.result
                        lines.push(`> \`\`\`\n> ${preview.replace(/\n/g, '\n> ')}\n> \`\`\`\n`)
                    }
                }
            }
        }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '_').slice(0, MAX_EXPORT_FILENAME_LENGTH)}.md`
    a.click()
    URL.revokeObjectURL(url)
}

export const ChatActionsMenu: React.FC<{
    chat: { id: string; title: string; isPinned: boolean }
    messages: Message[]
}> = ({ chat, messages }) => {
    const { pinChat, renameChat, deleteChat, selectChat, chats } = useAppStore()
    const [open, setOpen] = React.useState(false)
    const [notebooks, setNotebooks] = React.useState<string[]>([])
    const [showRenameModal, setShowRenameModal] = React.useState(false)
    const [showNotebookModal, setShowNotebookModal] = React.useState(false)
    const [renameValue, setRenameValue] = React.useState(chat.title)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const renameInputRef = React.useRef<HTMLInputElement>(null)

    React.useEffect(() => {
        notebookListNotebooks().then(setNotebooks).catch(() => setNotebooks([]))
    }, [])

    React.useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [open])

    React.useEffect(() => {
        if (showRenameModal) setTimeout(() => renameInputRef.current?.select(), 40)
    }, [showRenameModal])

    const handlePin = () => {
        patchSession(chat.id, { isPinned: !chat.isPinned }).catch(() => {})
        pinChat(chat.id)
        setOpen(false)
    }

    const handleRename = () => {
        setRenameValue(chat.title)
        setOpen(false)
        setShowRenameModal(true)
    }

    const commitRename = () => {
        const v = renameValue.trim()
        if (!v) return
        renameChat(chat.id, v)
        patchSession(chat.id, { title: v }).catch(() => {})
        setShowRenameModal(false)
    }

    const handleAddToNotebook = async (notebook: string) => {
        setShowNotebookModal(false)
        try {
            const md = messages
                .map((m) => `### ${m.role === 'user' ? t('you') : t('neo')}\n\n${m.content}`)
                .join('\n\n---\n\n')
            await notebookImportSource({
                notebook,
                kind: 'text',
                title: chat.title,
                content: md,
                source: 'ai-chat',
            })
            toast.success(`已添加到笔记本「${notebook}」`)
        } catch {
            toast.error('添加笔记本失败')
        }
    }

    const handleExport = () => {
        exportChatAsMarkdown(chat.title, messages)
        setOpen(false)
    }

    const handleDelete = async () => {
        setOpen(false)
        const ok = await confirmDialog(t('deleteChatConfirm'), { confirmText: t('delete'), destructive: true })
        if (!ok) return
        const remaining = chats.filter((c) => c.id !== chat.id)
        if (remaining.length > 0) selectChat(remaining[0].id)
        deleteSessionApi(chat.id).catch(() => {})
        deleteChat(chat.id)
    }

    return (
        <div ref={menuRef} className="relative ml-auto shrink-0">
            <button
                onClick={() => setOpen((v) => !v)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-colors cursor-pointer"
                title="更多操作"
            >
                <MoreHorizontal size={16} />
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-border bg-bg-container shadow-lg z-50 py-1 overflow-hidden text-sm">
                    <button onClick={handlePin} className="w-full flex items-center gap-2.5 px-3 py-2 text-text hover:bg-fill-secondary/60 transition-colors">
                        {chat.isPinned ? <PinOff size={13} className="text-text-tertiary shrink-0" /> : <Pin size={13} className="text-text-tertiary shrink-0" />}
                        <span>{chat.isPinned ? t('unpin') : t('pin')}</span>
                    </button>
                    <button onClick={handleRename} className="w-full flex items-center gap-2.5 px-3 py-2 text-text hover:bg-fill-secondary/60 transition-colors">
                        <PenLine size={13} className="text-text-tertiary shrink-0" />
                        <span>{t('rename')}</span>
                    </button>
                    {notebooks.length > 0 && (
                        <button
                            onClick={() => { setOpen(false); setShowNotebookModal(true) }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-text hover:bg-fill-secondary/60 transition-colors"
                        >
                            <BookOpen size={13} className="text-text-tertiary shrink-0" />
                            <span>添加至笔记本</span>
                        </button>
                    )}
                    <button onClick={handleExport} className="w-full flex items-center gap-2.5 px-3 py-2 text-text hover:bg-fill-secondary/60 transition-colors">
                        <Download size={13} className="text-text-tertiary shrink-0" />
                        <span>{t('exportMarkdown')}</span>
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button onClick={handleDelete} className="w-full flex items-center gap-2.5 px-3 py-2 text-text hover:bg-fill-secondary/60 transition-colors">
                        <Trash2 size={13} className="text-text-tertiary shrink-0" />
                        <span>{t('delete')}</span>
                    </button>
                </div>
            )}

            {showRenameModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowRenameModal(false)}>
                    <div className="bg-bg-container border border-border rounded-2xl p-5 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-sm font-semibold mb-3">{t('renameChat')}</h3>
                        <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setShowRenameModal(false) }}
                            className="w-full bg-fill border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 focus:border-primary-mint/40"
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setShowRenameModal(false)} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-fill transition-colors cursor-pointer">{t('cancel')}</button>
                            <button onClick={commitRename} className="px-3 py-1.5 rounded-lg text-sm bg-primary-mint text-white hover:opacity-90 transition-colors cursor-pointer">{t('save')}</button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}

            {showNotebookModal && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowNotebookModal(false)}>
                    <div className="bg-bg-container border border-border rounded-2xl p-5 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="text-sm font-semibold">移动对话</h3>
                            <button onClick={() => setShowNotebookModal(false)} className="p-1 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors cursor-pointer">
                                <X size={14} />
                            </button>
                        </div>
                        <p className="text-xs text-text-tertiary mb-4">选择要将此对话移入的笔记本</p>
                        <div className="space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar">
                            {notebooks.map((nb) => (
                                <button
                                    key={nb}
                                    onClick={() => handleAddToNotebook(nb)}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text hover:bg-fill-secondary/60 transition-colors text-left"
                                >
                                    <BookOpen size={14} className="text-text-tertiary shrink-0" />
                                    <span className="truncate">{nb}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    )
}
