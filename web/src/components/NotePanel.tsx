import React from 'react'
import { RefreshCw, FileText, MoreHorizontal, Trash2, Send, Hash, Bold, Italic, List, ListOrdered } from 'lucide-react'
import { cn } from '../lib/utils'
import { noteList, noteCreate, noteDelete, noteStats, noteTags } from '../api'
import type { InboxNote, NoteHeatmapDay, NoteTag } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNoteTime(note: InboxNote): string {
    const d = new Date(note.created_at)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseTags(tags: string | null): string[] {
    if (!tags) return []
    try { return JSON.parse(tags) as string[] } catch { return [] }
}

/** Extract #tags from content text */
function extractTags(text: string): string[] {
    const matches = text.match(/#([\u4e00-\u9fffa-zA-Z0-9_-]+)/g)
    if (!matches) return []
    return [...new Set(matches.map((m) => m.slice(1)))]
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

const HEATMAP_LEVELS = [
    'bg-fill-secondary',        // 0
    'bg-primary-mint/20',       // 1
    'bg-primary-mint/40',       // 2-3
    'bg-primary-mint/60',       // 4-6
    'bg-primary-mint',          // 7+
]

function getLevel(count: number): number {
    if (count === 0) return 0
    if (count === 1) return 1
    if (count <= 3) return 2
    if (count <= 6) return 3
    return 4
}

const Heatmap: React.FC<{
    data: NoteHeatmapDay[]
    totalNotes: number
    onDateClick: (date: string) => void
}> = ({ data, totalNotes, onDateClick }) => {
    // Build a map of date -> count
    const countMap = React.useMemo(() => {
        const m = new Map<string, number>()
        for (const d of data) m.set(d.date, d.count)
        return m
    }, [data])

    // Generate last ~16 weeks (112 days) of dates, aligned to weeks
    const cells = React.useMemo(() => {
        const today = new Date()
        const dayOfWeek = today.getDay() // 0=Sun
        // Go back to fill ~16 weeks + remainder of current week
        const totalDays = 16 * 7 + dayOfWeek + 1
        const days: { date: string; count: number }[] = []
        for (let i = totalDays - 1; i >= 0; i--) {
            const d = new Date(today)
            d.setDate(today.getDate() - i)
            const iso = d.toISOString().split('T')[0]
            days.push({ date: iso, count: countMap.get(iso) ?? 0 })
        }
        return days
    }, [countMap])

    // Arrange into columns (weeks), rows are days of week (Mon=0 in display)
    const weeks: { date: string; count: number }[][] = []
    let currentWeek: { date: string; count: number }[] = []
    for (const cell of cells) {
        const d = new Date(cell.date)
        if (d.getDay() === 0 && currentWeek.length > 0) {
            weeks.push(currentWeek)
            currentWeek = []
        }
        currentWeek.push(cell)
    }
    if (currentWeek.length) weeks.push(currentWeek)

    // Month labels
    const monthLabels = React.useMemo(() => {
        const labels: { label: string; col: number }[] = []
        let lastMonth = -1
        const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
        weeks.forEach((week, colIdx) => {
            const firstDay = new Date(week[0].date)
            const m = firstDay.getMonth()
            if (m !== lastMonth) {
                labels.push({ label: MONTHS[m], col: colIdx })
                lastMonth = m
            }
        })
        return labels
    }, [weeks])

    const totalDays = React.useMemo(() => {
        const first = cells[0]?.date
        if (!first) return 0
        return Math.ceil((Date.now() - new Date(first).getTime()) / 86400000)
    }, [cells])

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between">
                <span className="text-xs text-text-quaternary">{totalNotes} 笔记</span>
                <span className="text-xs text-text-quaternary">{totalDays} 天</span>
            </div>
            {/* Month labels */}
            <div className="relative h-4 overflow-hidden">
                <div className="flex" style={{ gap: 0 }}>
                    {monthLabels.map(({ label, col }) => (
                        <span key={`${label}-${col}`}
                            className="text-[10px] text-text-quaternary absolute"
                            style={{ left: col * 13 }}
                        >{label}</span>
                    ))}
                </div>
            </div>
            {/* Grid */}
            <div className="flex gap-[3px] overflow-x-auto">
                {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                        {week.map((cell) => (
                            <button key={cell.date}
                                onClick={() => cell.count > 0 && onDateClick(cell.date)}
                                title={`${cell.date}: ${cell.count} 笔记`}
                                className={cn(
                                    'w-[10px] h-[10px] rounded-[2px] transition-colors',
                                    HEATMAP_LEVELS[getLevel(cell.count)],
                                    cell.count > 0 && 'cursor-pointer hover:ring-1 hover:ring-primary-mint'
                                )}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── Tag list ─────────────────────────────────────────────────────────────────

const TagList: React.FC<{
    tags: NoteTag[]
    activeTag: string | null
    onSelect: (tag: string | null) => void
}> = ({ tags, activeTag, onSelect }) => {
    if (!tags.length) return null
    return (
        <div className="space-y-1">
            <p className="text-xs font-medium text-text-tertiary px-1 mb-1">全部标签</p>
            <button
                onClick={() => onSelect(null)}
                className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs transition-colors',
                    !activeTag ? 'bg-primary-mint/15 text-text font-medium' : 'text-text-secondary hover:bg-fill-secondary'
                )}
            >
                <FileText size={13} />
                全部笔记
            </button>
            {tags.map(({ tag, count }) => (
                <button key={tag}
                    onClick={() => onSelect(activeTag === tag ? null : tag)}
                    className={cn(
                        'flex items-center justify-between w-full px-2 py-1.5 rounded-lg text-xs transition-colors',
                        activeTag === tag ? 'bg-primary-mint/15 text-text font-medium' : 'text-text-secondary hover:bg-fill-secondary'
                    )}
                >
                    <span className="flex items-center gap-1.5 truncate">
                        <Hash size={12} className="shrink-0 text-text-quaternary" />
                        {tag}
                    </span>
                    <span className="text-text-quaternary tabular-nums">{count}</span>
                </button>
            ))}
        </div>
    )
}

// ── Note card (Flomo-style) ──────────────────────────────────────────────────

const NoteCard: React.FC<{
    note: InboxNote
    onDelete: (id: number) => void
    onTagClick: (tag: string) => void
}> = ({ note, onDelete, onTagClick }) => {
    const [menuOpen, setMenuOpen] = React.useState(false)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const tags = parseTags(note.tags)

    React.useEffect(() => {
        if (!menuOpen) return
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [menuOpen])

    // Render content with highlighted tags
    const renderContent = (text: string) => {
        const parts = text.split(/(#[\u4e00-\u9fffa-zA-Z0-9_-]+)/g)
        return parts.map((part, i) => {
            if (part.startsWith('#') && part.length > 1) {
                const tag = part.slice(1)
                return (
                    <button key={i} onClick={() => onTagClick(tag)}
                        className="text-primary-mint hover:underline font-medium">{part}</button>
                )
            }
            return <span key={i}>{part}</span>
        })
    }

    return (
        <div className="bg-bg-container rounded-xl border border-border p-4 transition-shadow hover:shadow-sm">
            {/* Header: time + menu */}
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-quaternary">{formatNoteTime(note)}</span>
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="p-1 rounded hover:bg-fill-secondary text-text-quaternary hover:text-text-tertiary transition-colors"
                    >
                        <MoreHorizontal size={16} />
                    </button>
                    {menuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-10 bg-bg-container border border-border rounded-lg shadow-lg py-1 min-w-[100px]">
                            <button
                                onClick={() => { onDelete(note.id); setMenuOpen(false) }}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-destructive hover:bg-fill-secondary transition-colors"
                            >
                                <Trash2 size={12} />
                                删除
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {/* Content */}
            <p className="text-sm text-text leading-relaxed whitespace-pre-wrap break-words">
                {renderContent(note.content)}
            </p>
            {/* Tags */}
            {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {tags.map((tag) => (
                        <button key={tag} onClick={() => onTagClick(tag)}
                            className="text-xs text-primary-mint/80 hover:text-primary-mint bg-primary-mint/10 px-1.5 py-0.5 rounded transition-colors">
                            #{tag}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Capture input (Flomo-style with toolbar) ─────────────────────────────────

const CaptureForm: React.FC<{ onCapture: (content: string, tags: string[]) => Promise<void> }> = ({ onCapture }) => {
    const [value, setValue] = React.useState('')
    const [loading, setLoading] = React.useState(false)
    const [focused, setFocused] = React.useState(false)
    const textRef = React.useRef<HTMLTextAreaElement>(null)

    const insertText = (before: string, after = '') => {
        const ta = textRef.current
        if (!ta) return
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const selected = value.substring(start, end)
        const newText = value.substring(0, start) + before + selected + after + value.substring(end)
        setValue(newText)
        setTimeout(() => {
            ta.focus()
            const cursorPos = start + before.length + selected.length + after.length
            ta.setSelectionRange(cursorPos, cursorPos)
        }, 0)
    }

    const submit = async () => {
        const trimmed = value.trim()
        if (!trimmed) return
        setLoading(true)
        try {
            const tags = extractTags(trimmed)
            await onCapture(trimmed, tags)
            setValue('')
            textRef.current?.focus()
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }

    const toolbarButtons = [
        { icon: <Hash size={16} />,        title: '插入标签 #', action: () => insertText('#') },
        { icon: <Bold size={16} />,        title: '加粗',       action: () => insertText('**', '**') },
        { icon: <Italic size={16} />,      title: '斜体',       action: () => insertText('*', '*') },
        { icon: <List size={16} />,        title: '无序列表',   action: () => insertText('\n- ') },
        { icon: <ListOrdered size={16} />, title: '有序列表',   action: () => insertText('\n1. ') },
    ]

    return (
        <div className={cn(
            'mx-4 mt-4 mb-2 bg-bg-container rounded-xl border transition-colors overflow-hidden',
            focused ? 'border-primary-mint/50 shadow-sm' : 'border-border'
        )}>
            <textarea
                ref={textRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="现在的想法是..."
                rows={3}
                className="w-full px-4 pt-3 pb-2 text-sm bg-transparent outline-none text-text placeholder:text-text-quaternary resize-none"
            />
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 pb-2.5">
                <div className="flex items-center gap-0.5">
                    {toolbarButtons.map((btn, i) => (
                        <button key={i} onMouseDown={(e) => { e.preventDefault(); btn.action() }}
                            title={btn.title}
                            className="p-1.5 rounded hover:bg-fill-secondary text-text-quaternary hover:text-text-tertiary transition-colors">
                            {btn.icon}
                        </button>
                    ))}
                </div>
                <button
                    onClick={submit}
                    disabled={!value.trim() || loading}
                    className={cn(
                        'p-2 rounded-full transition-colors',
                        value.trim()
                            ? 'bg-primary-mint/80 hover:bg-primary-mint text-white'
                            : 'bg-fill text-text-quaternary'
                    )}
                >
                    <Send size={14} />
                </button>
            </div>
        </div>
    )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export const NotePanel: React.FC = () => {
    const [notes, setNotes] = React.useState<InboxNote[]>([])
    const [heatmapData, setHeatmapData] = React.useState<NoteHeatmapDay[]>([])
    const [allTags, setAllTags] = React.useState<NoteTag[]>([])
    const [activeTag, setActiveTag] = React.useState<string | null>(null)
    const [activeDate, setActiveDate] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const loadNotes = React.useCallback((opts?: { tag?: string; date?: string }) => {
        setLoading(true)
        setError(null)
        noteList(opts).then(setNotes).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }, [])

    const loadMeta = React.useCallback(() => {
        noteStats().then(setHeatmapData).catch(() => {})
        noteTags().then(setAllTags).catch(() => {})
    }, [])

    React.useEffect(() => { loadNotes(); loadMeta() }, [loadNotes, loadMeta])

    // Re-fetch notes when filter changes
    React.useEffect(() => {
        if (activeTag) {
            loadNotes({ tag: activeTag })
            setActiveDate(null)
        } else if (activeDate) {
            loadNotes({ date: activeDate })
        } else {
            loadNotes()
        }
    }, [activeTag, activeDate, loadNotes])

    const handleCapture = async (content: string, tags: string[]) => {
        const note = await noteCreate(content, tags)
        setNotes((prev) => [note, ...prev])
        loadMeta() // refresh heatmap & tags
    }

    const handleDelete = async (id: number) => {
        setNotes((prev) => prev.filter((n) => n.id !== id))
        await noteDelete(id).catch(() => loadNotes())
        loadMeta()
    }

    const handleTagClick = (tag: string) => {
        setActiveTag((prev) => (prev === tag ? null : tag))
        setActiveDate(null)
    }

    const handleDateClick = (date: string) => {
        setActiveDate((prev) => (prev === date ? null : date))
        setActiveTag(null)
    }

    const clearFilter = () => { setActiveTag(null); setActiveDate(null) }

    const totalNotes = heatmapData.reduce((sum, d) => sum + d.count, 0)

    return (
        <div className="flex h-full bg-bg-layout">
            {/* Left sidebar: heatmap + tags */}
            <div className="w-64 shrink-0 border-r border-border bg-bg-container overflow-y-auto custom-scrollbar p-4 space-y-5 hidden md:block">
                <Heatmap data={heatmapData} totalNotes={totalNotes} onDateClick={handleDateClick} />
                <TagList tags={allTags} activeTag={activeTag} onSelect={(t) => { setActiveTag(t); setActiveDate(null) }} />
            </div>

            {/* Right: feed */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <div className="h-12 border-b border-border bg-bg-container flex items-center justify-between px-4 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">Notes</span>
                        {(activeTag || activeDate) && (
                            <span className="flex items-center gap-1 text-xs text-primary-mint bg-primary-mint/10 px-2 py-0.5 rounded-full">
                                {activeTag ? `#${activeTag}` : activeDate}
                                <button onClick={clearFilter} className="hover:text-text ml-0.5">&times;</button>
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => { loadNotes(activeTag ? { tag: activeTag } : activeDate ? { date: activeDate } : undefined); loadMeta() }}
                        disabled={loading}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-tertiary transition-colors disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Scrollable: capture + feed */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <CaptureForm onCapture={handleCapture} />

                    <div className="px-4 pb-4 space-y-3">
                        {loading && (
                            <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">Loading…</div>
                        )}
                        {error && (
                            <div className="flex items-center justify-center h-32 text-sm text-destructive">{error}</div>
                        )}
                        {!loading && !error && notes.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-quaternary">
                                <FileText size={28} />
                                <p className="text-sm">{activeTag || activeDate ? '没有匹配的笔记' : '还没有笔记'}</p>
                            </div>
                        )}
                        {!loading && !error && notes.map((note) => (
                            <NoteCard key={note.id} note={note} onDelete={handleDelete} onTagClick={handleTagClick} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
