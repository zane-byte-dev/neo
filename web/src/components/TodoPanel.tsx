import React from 'react'
import { Plus, Trash2, Circle, Clock, CheckCircle2, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { todoList, todoCreate, todoUpdateStatus, todoDelete } from '../api'
import type { TodoItem, TodoStatus } from '../types'

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_ORDER: TodoStatus[] = ['not-started', 'in-progress', 'completed']

function nextStatus(s: TodoStatus): TodoStatus {
    const idx = STATUS_ORDER.indexOf(s)
    return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
}

const StatusIcon: React.FC<{ status: TodoStatus; className?: string }> = ({ status, className }) => {
    if (status === 'completed') return <CheckCircle2 size={16} className={cn('text-success', className)} />
    if (status === 'in-progress') return <Clock size={16} className={cn('text-warning', className)} />
    return <Circle size={16} className={cn('text-text-quaternary', className)} />
}

const STATUS_LABEL: Record<TodoStatus, string> = {
    'not-started': 'To Do',
    'in-progress': 'In Progress',
    'completed': 'Done',
}

const STATUS_COLORS: Record<TodoStatus, string> = {
    'not-started': 'text-text-tertiary bg-fill border-border',
    'in-progress': 'text-warning bg-warning/10 border-warning/30',
    'completed': 'text-success bg-success/10 border-success/30',
}

// ── Single todo row ────────────────────────────────────────────────────────────

const TodoRow: React.FC<{
    item: TodoItem
    onToggle: (id: string, next: TodoStatus) => void
    onDelete: (id: string) => void
}> = ({ item, onToggle, onDelete }) => (
    <div
        className={cn(
            'group flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors hover:bg-fill-secondary',
            item.status === 'completed' && 'opacity-60'
        )}
    >
        <button
            onClick={() => onToggle(item.id, nextStatus(item.status))}
            className="mt-0.5 shrink-0 hover:scale-110 transition-transform"
            title={`Mark as ${STATUS_LABEL[nextStatus(item.status)]}`}
        >
            <StatusIcon status={item.status} />
        </button>

        <div className="flex-1 min-w-0">
            <p className={cn(
                'text-sm text-text leading-snug',
                item.status === 'completed' && 'line-through text-text-tertiary'
            )}>
                {item.content}
            </p>
            <div className="flex items-center gap-2 mt-1">
                <span className={cn('text-xs px-1.5 py-0.5 rounded border', STATUS_COLORS[item.status])}>
                    {STATUS_LABEL[item.status]}
                </span>
                {item.priority && (
                    <span className="text-xs text-text-tertiary">P{item.priority}</span>
                )}
                <span className="text-xs text-text-quaternary">
                    {new Date(item.created_at).toLocaleDateString()}
                </span>
            </div>
        </div>

        <button
            onClick={() => onDelete(item.id)}
            className="shrink-0 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-fill rounded-lg text-text-tertiary hover:text-destructive transition-all"
            title="Delete"
        >
            <Trash2 size={13} />
        </button>
    </div>
)

// ── Add todo form ─────────────────────────────────────────────────────────────

const AddTodoForm: React.FC<{ onAdd: (content: string) => Promise<void> }> = ({ onAdd }) => {
    const [value, setValue] = React.useState('')
    const [loading, setLoading] = React.useState(false)

    const submit = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setLoading(true)
        try {
            await onAdd(trimmed)
            setValue('')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex gap-2 p-3 border-b border-border bg-bg-container">
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Add a todo…"
                className="flex-1 px-3 py-2 text-sm bg-fill-secondary border border-border rounded-lg outline-none focus:border-primary-mint/60 focus:bg-bg-container text-text placeholder:text-text-quaternary transition-colors"
            />
            <button
                onClick={submit}
                disabled={!value.trim() || loading}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary-mint/20 hover:bg-primary-mint/30 border border-primary-mint/40 rounded-lg text-sm text-text disabled:opacity-40 transition-colors"
            >
                <Plus size={14} />
                Add
            </button>
        </div>
    )
}

// ── Filter bar ────────────────────────────────────────────────────────────────

type Filter = 'all' | TodoStatus

const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'not-started', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'completed', label: 'Done' },
]

// ── Main panel ────────────────────────────────────────────────────────────────

export const TodoPanel: React.FC = () => {
    const [items, setItems] = React.useState<TodoItem[]>([])
    const [filter, setFilter] = React.useState<Filter>('all')
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const load = React.useCallback(() => {
        setLoading(true)
        setError(null)
        todoList()
            .then(setItems)
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false))
    }, [])

    React.useEffect(() => { load() }, [load])

    const handleAdd = async (content: string) => {
        const item = await todoCreate(content)
        setItems((prev) => [item, ...prev])
    }

    const handleToggle = async (id: string, next: TodoStatus) => {
        setItems((prev) => prev.map((t) => t.id === id ? { ...t, status: next } : t))
        await todoUpdateStatus(id, next).catch(() => load())
    }

    const handleDelete = async (id: string) => {
        setItems((prev) => prev.filter((t) => t.id !== id))
        await todoDelete(id).catch(() => load())
    }

    const filtered = filter === 'all' ? items : items.filter((t) => t.status === filter)
    const counts = {
        all: items.length,
        'not-started': items.filter((t) => t.status === 'not-started').length,
        'in-progress': items.filter((t) => t.status === 'in-progress').length,
        completed: items.filter((t) => t.status === 'completed').length,
    }

    return (
        <div className="flex flex-col h-full bg-bg-layout">
            {/* Header */}
            <div className="h-12 border-b border-border bg-bg-container flex items-center justify-between px-4 shrink-0">
                <span className="text-sm font-semibold text-text">Todos</span>
                <button
                    onClick={load}
                    className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-tertiary transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* Add form */}
            <AddTodoForm onAdd={handleAdd} />

            {/* Filter tabs */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-bg-container shrink-0">
                {FILTERS.map(({ value, label }) => (
                    <button
                        key={value}
                        onClick={() => setFilter(value)}
                        className={cn(
                            'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                            filter === value
                                ? 'bg-primary-mint/15 text-text'
                                : 'text-text-secondary hover:bg-fill-secondary'
                        )}
                    >
                        {label}
                        <span className="text-text-quaternary">({counts[value]})</span>
                    </button>
                ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && (
                    <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
                        Loading…
                    </div>
                )}
                {error && (
                    <div className="flex items-center justify-center h-32 text-sm text-destructive">
                        {error}
                    </div>
                )}
                {!loading && !error && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-quaternary">
                        <CheckCircle2 size={28} />
                        <p className="text-sm">No todos here</p>
                    </div>
                )}
                {!loading && !error && filtered.length > 0 && (
                    <div className="bg-bg-container mx-4 my-4 rounded-xl border border-border overflow-hidden">
                        {filtered.map((item) => (
                            <TodoRow
                                key={item.id}
                                item={item}
                                onToggle={handleToggle}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
