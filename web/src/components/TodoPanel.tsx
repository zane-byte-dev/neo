import React from 'react'
import { Plus, Trash2, Circle, CheckCircle2, RefreshCw, Bell, BellOff, Sparkles, X, Loader2, Pencil } from 'lucide-react'
import { cn } from '../lib/utils'
import { todoList, todoCreate, todoUpdateStatus, todoDelete, todoAnalyze, todoUpdate } from '../api'
import type { TodoItem, TodoStatus, TodoAnalysis } from '../types'

// ── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
    high:   'text-destructive bg-destructive/10 border-destructive/30',
    medium: 'text-warning bg-warning/10 border-warning/30',
    low:    'text-info bg-info/10 border-info/30',
}

const PRIORITY_LABELS: Record<string, string> = {
    high: '高', medium: '中', low: '低',
}

const PRIORITY_ORDER: Record<string, number> = {
    high: 0, medium: 1, low: 2,
}

function sortByPriority(a: TodoItem, b: TodoItem): number {
    const pa = a.priority ? (PRIORITY_ORDER[a.priority] ?? 3) : 3
    const pb = b.priority ? (PRIORITY_ORDER[b.priority] ?? 3) : 3
    if (pa !== pb) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

function formatRemindAt(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const today = now.toDateString()
    const target = d.toDateString()
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    if (target === today) return `今天 ${time}`
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    if (target === tomorrow.toDateString()) return `明天 ${time}`
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

function isOverdue(iso: string): boolean {
    return new Date(iso) < new Date()
}

function toDatetimeLocal(iso: string | null): string {
    if (!iso) return ''
    try {
        const d = new Date(iso)
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    } catch { return '' }
}

// ── Components ───────────────────────────────────────────────────────────────

const StatusToggle: React.FC<{ status: TodoStatus; onClick: () => void }> = ({ status, onClick }) => (
    <button onClick={onClick} className="mt-0.5 shrink-0 hover:scale-110 transition-transform"
        title={status === 'completed' ? 'Mark as To Do' : 'Mark as Done'}>
        {status === 'completed'
            ? <CheckCircle2 size={16} className="text-success" />
            : <Circle size={16} className="text-text-quaternary hover:text-primary-mint transition-colors" />}
    </button>
)

const RemindBadge: React.FC<{ remindAt: string }> = ({ remindAt }) => {
    const overdue = isOverdue(remindAt)
    return (
        <span className={cn(
            'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border',
            overdue ? 'text-destructive bg-destructive/10 border-destructive/30' : 'text-text-tertiary bg-fill border-border'
        )}>
            <Bell size={10} />
            {formatRemindAt(remindAt)}
        </span>
    )
}

const PRIORITY_OPTIONS = [
    { value: '', label: '无' },
    { value: 'high',   label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low',    label: '低' },
]

const TodoRow: React.FC<{
    item: TodoItem
    onToggle: (id: string) => void
    onDelete: (id: string) => void
    onUpdate: (id: string, patch: { content?: string; remind_at?: string | null; priority?: string | null }) => Promise<void>
}> = ({ item, onToggle, onDelete, onUpdate }) => {
    const [editing, setEditing] = React.useState(false)
    const [editContent, setEditContent] = React.useState(item.content)
    const [editRemindAt, setEditRemindAt] = React.useState(toDatetimeLocal(item.remind_at))
    const [editPriority, setEditPriority] = React.useState(item.priority ?? '')
    const [saving, setSaving] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)

    const openEdit = () => {
        setEditContent(item.content)
        setEditRemindAt(toDatetimeLocal(item.remind_at))
        setEditPriority(item.priority ?? '')
        setEditing(true)
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    const saveEdit = async () => {
        const trimmed = editContent.trim()
        if (!trimmed) return
        setSaving(true)
        try {
            await onUpdate(item.id, {
                content: trimmed,
                remind_at: editRemindAt ? new Date(editRemindAt).toISOString() : null,
                priority: editPriority || null,
            })
            setEditing(false)
        } finally {
            setSaving(false)
        }
    }

    const cancelEdit = () => {
        setEditing(false)
        setEditContent(item.content)
        setEditRemindAt(toDatetimeLocal(item.remind_at))
        setEditPriority(item.priority ?? '')
    }

    const rowOverdue = item.status !== 'completed' && !!item.remind_at && isOverdue(item.remind_at)

    if (editing) {
        return (
            <div className="px-4 py-3 border-b border-border last:border-0 bg-fill-secondary space-y-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                    className="w-full px-2.5 py-1.5 text-sm bg-bg-container border border-primary-mint/40 rounded-lg outline-none text-text"
                />
                <div className="flex items-center gap-2">
                    <Bell size={12} className="text-text-tertiary shrink-0" />
                    <input
                        type="datetime-local"
                        value={editRemindAt}
                        onChange={(e) => setEditRemindAt(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs bg-bg-container border border-border rounded-lg outline-none focus:border-primary-mint/60 text-text transition-colors"
                    />
                    {editRemindAt && (
                        <button onClick={() => setEditRemindAt('')} className="p-1 text-text-tertiary hover:text-text rounded">
                            <BellOff size={12} />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary shrink-0">优先级</span>
                    <div className="flex gap-1">
                        {PRIORITY_OPTIONS.map((opt) => (
                            <button key={opt.value} onClick={() => setEditPriority(opt.value)}
                                className={cn(
                                    'px-2 py-0.5 text-xs rounded border transition-colors',
                                    editPriority === opt.value
                                        ? (opt.value ? cn('font-medium', PRIORITY_COLORS[opt.value]) : 'bg-fill border-border/80 text-text')
                                        : 'border-border text-text-tertiary hover:bg-fill'
                                )}>
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2 justify-end">
                    <button onClick={cancelEdit} className="px-3 py-1 text-xs border border-border rounded-lg text-text-secondary hover:bg-fill transition-colors">
                        取消
                    </button>
                    <button onClick={saveEdit} disabled={!editContent.trim() || saving}
                        className="flex items-center gap-1 px-3 py-1 text-xs bg-primary-mint/20 hover:bg-primary-mint/30 border border-primary-mint/40 rounded-lg text-text disabled:opacity-40 transition-colors">
                        {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                        保存
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className={cn(
            'group flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors hover:bg-fill-secondary',
            item.status === 'completed' && 'opacity-55',
            rowOverdue && 'bg-destructive/5'
        )}>
            <StatusToggle status={item.status} onClick={() => onToggle(item.id)} />
            <div className="flex-1 min-w-0">
                <p className={cn('text-sm text-text leading-snug', item.status === 'completed' && 'line-through text-text-tertiary')}>
                    {item.content}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {item.remind_at && <RemindBadge remindAt={item.remind_at} />}
                    {item.priority && PRIORITY_COLORS[item.priority] && (
                        <span className={cn('text-xs px-1.5 py-0.5 rounded border', PRIORITY_COLORS[item.priority])}>
                            {PRIORITY_LABELS[item.priority] ?? item.priority}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0">
                <button onClick={openEdit}
                    className="p-1.5 hover:bg-fill rounded-lg text-text-tertiary hover:text-text transition-colors">
                    <Pencil size={13} />
                </button>
                <button onClick={() => onDelete(item.id)}
                    className="p-1.5 hover:bg-fill rounded-lg text-text-tertiary hover:text-destructive transition-colors">
                    <Trash2 size={13} />
                </button>
            </div>
        </div>
    )
}

const AnalysisPreview: React.FC<{
    analysis: TodoAnalysis
    onConfirm: (a: TodoAnalysis) => Promise<void>
    onCancel: () => void
}> = ({ analysis, onConfirm, onCancel }) => {
    const [remindAt, setRemindAt] = React.useState(toDatetimeLocal(analysis.remind_at))
    const [confirming, setConfirming] = React.useState(false)

    const handleConfirm = async () => {
        setConfirming(true)
        try {
            await onConfirm({ ...analysis, remind_at: remindAt ? new Date(remindAt).toISOString() : null })
        } finally {
            setConfirming(false)
        }
    }

    return (
        <div className="mx-3 mb-3 p-3 bg-primary-mint/5 border border-primary-mint/25 rounded-xl text-sm space-y-3">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary font-medium">
                <Sparkles size={12} className="text-primary-mint" />
                AI 解析结果
            </div>
            <p className="text-text font-medium leading-snug">{analysis.content}</p>
            <div className="space-y-1">
                <label className="flex items-center gap-1 text-xs text-text-tertiary">
                    <Bell size={11} />
                    提醒时间
                </label>
                <div className="flex items-center gap-2">
                    <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs bg-bg-container border border-border rounded-lg outline-none focus:border-primary-mint/60 text-text transition-colors" />
                    {remindAt && (
                        <button onClick={() => setRemindAt('')} className="p-1 text-text-tertiary hover:text-text rounded" title="清除提醒">
                            <BellOff size={13} />
                        </button>
                    )}
                </div>
            </div>
            {analysis.priority && PRIORITY_COLORS[analysis.priority] && (
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    优先级：
                    <span className={cn('px-1.5 py-0.5 rounded border', PRIORITY_COLORS[analysis.priority])}>
                        {PRIORITY_LABELS[analysis.priority] ?? analysis.priority}
                    </span>
                </div>
            )}
            <div className="flex gap-2 pt-1">
                <button onClick={handleConfirm} disabled={confirming}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-primary-mint/20 hover:bg-primary-mint/30 border border-primary-mint/40 rounded-lg text-xs text-text font-medium disabled:opacity-50 transition-colors">
                    {confirming ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    确认创建
                </button>
                <button onClick={onCancel}
                    className="px-3 py-1.5 hover:bg-fill-secondary border border-border rounded-lg text-xs text-text-secondary transition-colors">
                    <X size={12} />
                </button>
            </div>
        </div>
    )
}

const AddTodoForm: React.FC<{ onAdd: (a: TodoAnalysis) => Promise<void> }> = ({ onAdd }) => {
    const [value, setValue] = React.useState('')
    const [analyzing, setAnalyzing] = React.useState(false)
    const [analysis, setAnalysis] = React.useState<TodoAnalysis | null>(null)

    const handleAnalyze = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setAnalyzing(true)
        setAnalysis(null)
        try {
            const result = await todoAnalyze(trimmed)
            setAnalysis(result)
        } catch {
            await onAdd({ content: trimmed, remind_at: null, priority: null })
            setValue('')
        } finally {
            setAnalyzing(false)
        }
    }

    const handleConfirm = async (finalAnalysis: TodoAnalysis) => {
        await onAdd(finalAnalysis)
        setValue('')
        setAnalysis(null)
    }

    return (
        <div className="border-b border-border bg-bg-container shrink-0">
            <div className="flex gap-2 p-3">
                <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !analyzing && handleAnalyze()}
                    placeholder="添加 todo…（AI 自动解析提醒时间）"
                    disabled={analyzing}
                    className="flex-1 px-3 py-2 text-sm bg-fill-secondary border border-border rounded-lg outline-none focus:border-primary-mint/60 focus:bg-bg-container text-text placeholder:text-text-quaternary transition-colors disabled:opacity-50" />
                <button onClick={handleAnalyze} disabled={!value.trim() || analyzing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-primary-mint/20 hover:bg-primary-mint/30 border border-primary-mint/40 rounded-lg text-sm text-text disabled:opacity-40 transition-colors">
                    {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {analyzing ? '分析中…' : '添加'}
                </button>
            </div>
            {analysis && (
                <AnalysisPreview analysis={analysis} onConfirm={handleConfirm} onCancel={() => setAnalysis(null)} />
            )}
        </div>
    )
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Filter = 'all' | 'pending' | 'completed'

const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all',       label: '全部' },
    { value: 'pending',   label: '待完成' },
    { value: 'completed', label: '已完成' },
]

export const TodoPanel: React.FC = () => {
    const [items, setItems] = React.useState<TodoItem[]>([])
    const [filter, setFilter] = React.useState<Filter>('pending')
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const load = React.useCallback(() => {
        setLoading(true)
        setError(null)
        todoList().then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }, [])

    React.useEffect(() => { load() }, [load])

    const handleAdd = async (analysis: TodoAnalysis) => {
        const item = await todoCreate(analysis.content, analysis.priority, analysis.remind_at)
        setItems((prev) => [item, ...prev])
    }

    const handleToggle = async (id: string) => {
        const item = items.find((t) => t.id === id)
        if (!item) return
        const next: TodoStatus = item.status === 'completed' ? 'not-started' : 'completed'
        setItems((prev) => prev.map((t) => t.id === id ? { ...t, status: next } : t))
        await todoUpdateStatus(id, next).catch(() => load())
    }

    const handleDelete = async (id: string) => {
        setItems((prev) => prev.filter((t) => t.id !== id))
        await todoDelete(id).catch(() => load())
    }

    const handleUpdate = async (id: string, patch: { content?: string; remind_at?: string | null; priority?: string | null }) => {
        setItems((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
        await todoUpdate(id, patch).catch(() => load())
    }

    const handleClearCompleted = async () => {
        const completedIds = items.filter((t) => t.status === 'completed').map((t) => t.id)
        if (!completedIds.length) return
        setItems((prev) => prev.filter((t) => t.status !== 'completed'))
        await Promise.all(completedIds.map((id) => todoDelete(id))).catch(() => load())
    }

    const filtered = React.useMemo(() => {
        if (filter === 'pending') {
            return [...items.filter((t) => t.status === 'not-started')].sort(sortByPriority)
        }
        if (filter === 'completed') return items.filter((t) => t.status === 'completed')
        // 'all': pending sorted by priority first, then completed
        const pending = [...items.filter((t) => t.status === 'not-started')].sort(sortByPriority)
        const completed = items.filter((t) => t.status === 'completed')
        return [...pending, ...completed]
    }, [items, filter])

    const counts = {
        all: items.length,
        pending: items.filter((t) => t.status === 'not-started').length,
        completed: items.filter((t) => t.status === 'completed').length,
    }

    const emptyText = filter === 'completed' ? '没有已完成的事项' : filter === 'pending' ? '没有待办事项' : '没有任何事项'

    return (
        <div className="flex flex-col h-full bg-bg-layout">
            <div className="h-12 border-b border-border bg-bg-container flex items-center justify-between px-4 shrink-0">
                <span className="text-sm font-semibold text-text">Todos</span>
                <button onClick={load} disabled={loading} className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-tertiary transition-colors disabled:opacity-50">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <AddTodoForm onAdd={handleAdd} />

            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-bg-container shrink-0">
                {FILTERS.map(({ value, label }) => (
                    <button key={value} onClick={() => setFilter(value)}
                        className={cn(
                            'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                            filter === value ? 'bg-primary-mint/15 text-text' : 'text-text-secondary hover:bg-fill-secondary'
                        )}>
                        {label}
                        <span className={cn(
                            'text-xs tabular-nums',
                            filter === value ? 'text-text-tertiary' : 'text-text-quaternary'
                        )}>{counts[value]}</span>
                    </button>
                ))}
                {counts.completed > 0 && (
                    <button onClick={handleClearCompleted}
                        className="ml-auto text-xs text-text-quaternary hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-fill-secondary">
                        清除已完成
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">Loading…</div>}
                {error && <div className="flex items-center justify-center h-32 text-sm text-destructive">{error}</div>}
                {!loading && !error && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-quaternary">
                        <CheckCircle2 size={28} />
                        <p className="text-sm">{emptyText}</p>
                    </div>
                )}
                {!loading && !error && filtered.length > 0 && (
                    <div className="bg-bg-container mx-4 my-4 rounded-xl border border-border overflow-hidden">
                        {filtered.map((item) => (
                            <TodoRow key={item.id} item={item} onToggle={handleToggle} onDelete={handleDelete} onUpdate={handleUpdate} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
