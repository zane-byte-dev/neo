import React from 'react'
import { StickyNote, Plus, Trash2, Loader2 } from 'lucide-react'
import { useAppStore } from '../../../stores/useAppStore'
import {
    notebookListNotes, notebookSaveNote, notebookDeleteNote, notebookConvertNoteToSource, notebookNoteQuickAction,
    type NoteQuickAction,
} from '../../../api'
import type { NotebookNote } from '../../../types'
import { toast } from '../../Toast'
import { confirm } from '../../ConfirmDialog'

interface Props { notebook: string }

export const NotesTab: React.FC<Props> = ({ notebook }) => {
    const { notebookNotes, setNotebookNotes } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [editing, setEditing] = React.useState<NotebookNote | 'new' | null>(null)
    const [selectedIds, setSelectedIds] = React.useState<string[]>([])
    const [actionLoading, setActionLoading] = React.useState(false)

    const load = React.useCallback(() => {
        setLoading(true)
        notebookListNotes(notebook).then(setNotebookNotes).catch(() => setNotebookNotes([])).finally(() => setLoading(false))
    }, [notebook, setNotebookNotes])

    React.useEffect(load, [load])

    const toggle = (id: string) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

    const runQuick = async (action: NoteQuickAction) => {
        if (selectedIds.length === 0) { toast.warning('请选择至少一条笔记'); return }
        setActionLoading(true)
        try {
            await notebookNoteQuickAction(notebook, action, selectedIds)
            setSelectedIds([])
            load()
        } catch (e) {
            toast.error(`失败：${(e as Error).message}`)
        } finally { setActionLoading(false) }
    }

    const convertToSource = async (id: string) => {
        if (!(await confirm('将此笔记转为来源？', { confirmText: '转换' }))) return
        try {
            await notebookConvertNoteToSource(notebook, id)
            load()
        } catch (e) { toast.error((e as Error).message) }
    }

    if (editing !== null) {
        return <NoteEditorInline notebook={notebook} note={editing === 'new' ? null : editing} onSaved={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex flex-wrap gap-1.5 shrink-0">
                <button onClick={() => setEditing('new')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90">
                    <Plus size={11} /> 新建笔记
                </button>
                {selectedIds.length > 0 && (
                    <>
                        <span className="text-xs text-text-tertiary self-center mx-1">已选 {selectedIds.length}</span>
                        <button disabled={actionLoading} onClick={() => runQuick('merge')}       className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">合并</button>
                        <button disabled={actionLoading} onClick={() => runQuick('outline')}     className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">大纲</button>
                        <button disabled={actionLoading} onClick={() => runQuick('feedback')}    className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">反馈</button>
                        <button disabled={actionLoading} onClick={() => runQuick('study-guide')} className="text-xs px-2.5 py-1.5 bg-fill-secondary hover:bg-fill rounded-lg disabled:opacity-50">学习指南</button>
                    </>
                )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {loading && <div className="text-xs text-text-tertiary text-center py-4">加载中…</div>}
                {!loading && notebookNotes.length === 0 && (
                    <div className="text-center text-text-quaternary text-sm py-8">
                        <StickyNote size={24} className="mx-auto mb-2" />
                        <p>还没有笔记</p>
                    </div>
                )}
                {notebookNotes.map((n) => (
                    <div key={n.id} className="border border-border rounded-xl p-3 hover:bg-fill-secondary/40 transition-colors">
                        <div className="flex items-start gap-2">
                            <input type="checkbox" checked={selectedIds.includes(n.id)} onChange={() => toggle(n.id)} className="mt-1 accent-[var(--primary-mint)]" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-medium flex-1 truncate">{n.title}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${n.source === 'user' ? 'bg-fill text-text-tertiary' : n.source === 'ai-chat' ? 'bg-primary-mint/15 text-primary-mint' : 'bg-orange-500/15 text-orange-600'}`}>
                                        {n.source === 'user' ? '手动' : n.source === 'ai-chat' ? 'AI 对话' : 'AI 生成'}
                                    </span>
                                </div>
                                <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{n.content}</p>
                                <div className="flex items-center gap-2 mt-2">
                                    <button onClick={() => setEditing(n)} className="text-xs text-primary-mint hover:underline">编辑</button>
                                    <button onClick={() => convertToSource(n.id)} className="text-xs text-text-tertiary hover:text-text">→ 转为来源</button>
                                    <button
                                        onClick={async () => {
                                            if (await confirm('删除此笔记？', { destructive: true, confirmText: '删除' })) { await notebookDeleteNote(notebook, n.id); load() }
                                        }}
                                        className="text-xs text-text-tertiary hover:text-destructive ml-auto"
                                    >
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

const NoteEditorInline: React.FC<{ notebook: string; note: NotebookNote | null; onSaved: () => void; onCancel: () => void }> = ({ notebook, note, onSaved, onCancel }) => {
    const [title, setTitle] = React.useState(note?.title ?? '')
    const [content, setContent] = React.useState(note?.content ?? '')
    const [saving, setSaving] = React.useState(false)

    const save = async () => {
        if (!title.trim()) return
        setSaving(true)
        try {
            await notebookSaveNote(notebook, { id: note?.id, title: title.trim(), content, source: note?.source ?? 'user' })
            onSaved()
        } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex gap-2 shrink-0">
                <button onClick={onCancel} className="text-xs px-2.5 py-1.5 bg-fill-secondary rounded-lg hover:bg-fill">取消</button>
                <button onClick={save} disabled={saving || !title.trim()} className="ml-auto text-xs px-2.5 py-1.5 bg-primary-mint text-white rounded-lg disabled:opacity-50">
                    {saving ? <Loader2 size={11} className="animate-spin" /> : '保存'}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-mint/30" />
                <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="内容 (Markdown)" rows={20} className="w-full bg-fill-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none font-mono" />
            </div>
        </div>
    )
}
