import React from 'react'
import { Folder, FolderOpen, Plus, Check, X, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { fetchProjects, registerProjectApi, deleteProjectApi, patchSession, type ProjectEntry } from '../api'
import { useAppStore } from '../stores/useAppStore'
import { toast } from './Toast'

interface ProjectPickerProps {
    sessionId: string
    /** Current project root for the session (null = user.workDir / default). */
    projectRoot: string | null | undefined
}

/**
 * Lightweight dropdown that shows the active session's project root and
 * lets the user switch to one of the recent registered project paths
 * (or add a new absolute directory). Setting null reverts to the user's
 * default workDir.
 */
export const ProjectPicker: React.FC<ProjectPickerProps> = ({ sessionId, projectRoot }) => {
    const [open, setOpen] = React.useState(false)
    const [projects, setProjects] = React.useState<ProjectEntry[]>([])
    const [adding, setAdding] = React.useState(false)
    const [newPath, setNewPath] = React.useState('')
    const [newName, setNewName] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const setChats = useAppStore((s) => s.setChats)
    const chats = useAppStore((s) => s.chats)
    const ref = React.useRef<HTMLDivElement>(null)

    const reload = React.useCallback(() => {
        fetchProjects().then((r) => setProjects(r.projects ?? [])).catch(() => setProjects([]))
    }, [])

    React.useEffect(() => {
        if (open) reload()
    }, [open, reload])

    React.useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false)
                setAdding(false)
            }
        }
        if (open) document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const updateLocal = (next: string | null) => {
        setChats(chats.map((c) => c.id === sessionId ? { ...c, projectRoot: next } : c))
    }

    const switchTo = async (path: string | null) => {
        setBusy(true)
        try {
            const res = await patchSession(sessionId, { projectRoot: path })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err?.error || 'Failed to switch project')
                return
            }
            updateLocal(path)
            setOpen(false)
            toast.success(path ? `已切换到 ${path}` : '已恢复默认目录')
        } finally {
            setBusy(false)
        }
    }

    const addNew = async () => {
        const p = newPath.trim()
        if (!p) return
        setBusy(true)
        try {
            const entry = await registerProjectApi(p, newName.trim() || undefined)
            await switchTo(entry.path)
            setNewPath('')
            setNewName('')
            setAdding(false)
            reload()
        } catch (err) {
            const msg = (err as { error?: string })?.error || (err instanceof Error ? err.message : 'Failed to add project')
            toast.error(msg)
        } finally {
            setBusy(false)
        }
    }

    const removeEntry = async (id: string) => {
        await deleteProjectApi(id)
        reload()
    }

    const label = projectRoot
        ? projectRoot.split('/').filter(Boolean).slice(-1)[0] || projectRoot
        : '默认目录'

    return (
        <div ref={ref} className="relative shrink-0">
            <button
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs',
                    'text-text-secondary hover:text-text hover:bg-fill transition-colors cursor-pointer',
                    projectRoot && 'text-primary-mint',
                )}
                title={projectRoot ?? '使用默认 workDir'}
            >
                {projectRoot ? <FolderOpen size={13} /> : <Folder size={13} />}
                <span className="max-w-[160px] truncate">{label}</span>
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-border bg-bg-container shadow-lg z-50 py-1 text-sm">
                    <button
                        disabled={busy}
                        onClick={() => switchTo(null)}
                        className={cn(
                            'w-full text-left px-3 py-2 hover:bg-fill flex items-center gap-2',
                            !projectRoot && 'text-primary-mint',
                        )}
                    >
                        <Folder size={13} />
                        <span className="flex-1">默认目录</span>
                        {!projectRoot && <Check size={13} />}
                    </button>
                    {projects.length > 0 && <div className="my-1 border-t border-border" />}
                    {projects.map((p) => (
                        <div key={p.id} className="group flex items-center hover:bg-fill">
                            <button
                                disabled={busy}
                                onClick={() => switchTo(p.path)}
                                className={cn(
                                    'flex-1 text-left px-3 py-2 flex items-center gap-2 min-w-0',
                                    projectRoot === p.path && 'text-primary-mint',
                                )}
                            >
                                <FolderOpen size={13} />
                                <span className="flex-1 min-w-0">
                                    <div className="truncate">{p.name}</div>
                                    <div className="text-[10px] text-text-tertiary truncate">{p.path}</div>
                                </span>
                                {projectRoot === p.path && <Check size={13} />}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); removeEntry(p.id) }}
                                className="opacity-0 group-hover:opacity-100 px-2 py-2 text-text-tertiary hover:text-red-500"
                                title="移除"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                    <div className="my-1 border-t border-border" />
                    {!adding ? (
                        <button
                            onClick={() => setAdding(true)}
                            className="w-full text-left px-3 py-2 hover:bg-fill flex items-center gap-2 text-text-secondary"
                        >
                            <Plus size={13} />
                            <span>添加目录…</span>
                        </button>
                    ) : (
                        <div className="px-3 py-2 space-y-1.5">
                            <input
                                autoFocus
                                value={newPath}
                                onChange={(e) => setNewPath(e.target.value)}
                                placeholder="/absolute/path/to/project"
                                className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-input"
                            />
                            <input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="名称（可选）"
                                className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-input"
                            />
                            <div className="flex gap-1.5">
                                <button
                                    disabled={busy || !newPath.trim()}
                                    onClick={addNew}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-primary-mint text-white disabled:opacity-50"
                                >
                                    添加
                                </button>
                                <button
                                    onClick={() => { setAdding(false); setNewPath(''); setNewName('') }}
                                    className="px-2 py-1 text-xs rounded border border-border"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
