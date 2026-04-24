/**
 * SourceDetailView — full-width source content viewer.
 * Shown in the middle column when a source is clicked.
 * Features: collapsible guide section + raw content, in-content search (Ctrl+F style).
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Link as LinkIcon, Youtube, Type, Loader2, Sparkles, ExternalLink, BookOpen, Search, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { notebookGetSource, notebookGetSourceGuide, notebookGenerateSourceGuide } from '../../api'
import type { SourceMeta, SourceGuide } from '../../types'

interface Props {
    notebook: string
    source: SourceMeta
    onBack: () => void
}

const TYPE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    url: LinkIcon,
    youtube: Youtube,
    pdf: FileText,
    text: Type,
    audio: FileText,
    image: FileText,
}

const TYPE_LABEL: Record<string, string> = {
    url: '网页',
    youtube: 'YouTube',
    pdf: 'PDF 文档',
    text: '文本',
    audio: '音频',
    image: '图片',
}

export const SourceDetailView: React.FC<Props> = ({ notebook, source, onBack }) => {
    const { sourceGuides, setSourceGuide, selectedModel } = useAppStore()
    const [content, setContent] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [guideLoading, setGuideLoading] = React.useState(false)
    const [guideCollapsed, setGuideCollapsed] = React.useState(false)
    const [searchOpen, setSearchOpen] = React.useState(false)
    const [searchTerm, setSearchTerm] = React.useState('')
    const [matchIndex, setMatchIndex] = React.useState(0)

    const guide = sourceGuides[source.id] ?? null

    // Ctrl+F shortcut
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault()
                setSearchOpen(true)
            }
            if (e.key === 'Escape' && searchOpen) {
                setSearchOpen(false)
                setSearchTerm('')
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [searchOpen])

    // Load source content + guide
    React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        setContent(null)

        Promise.all([
            notebookGetSource(notebook, source.id).then((data) => {
                if (!cancelled) setContent(data.content)
            }),
            // Only fetch guide if not already cached
            sourceGuides[source.id] === undefined
                ? notebookGetSourceGuide(notebook, source.id)
                      .then((g) => { if (!cancelled) setSourceGuide(source.id, g) })
                      .catch(() => { if (!cancelled) setSourceGuide(source.id, null) })
                : Promise.resolve(),
        ]).finally(() => {
            if (!cancelled) setLoading(false)
        })

        return () => { cancelled = true }
    }, [notebook, source.id])

    const handleGenerateGuide = async () => {
        setGuideLoading(true)
        try {
            const g = await notebookGenerateSourceGuide(notebook, source.id, selectedModel === 'auto' ? undefined : selectedModel)
            setSourceGuide(source.id, g)
            setGuideCollapsed(false)
        } catch { /* ignore */ }
        finally { setGuideLoading(false) }
    }

    const Icon = TYPE_ICON[source.type] ?? FileText

    const totalMatches = React.useMemo(
        () => (searchTerm ? countMatches(content ?? '', searchTerm) : 0),
        [content, searchTerm],
    )

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border shrink-0 bg-bg-container">
                <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                        <Icon size={12} />
                        <span>{TYPE_LABEL[source.type] ?? source.type}</span>
                    </div>
                    {source.source && (
                        <a
                            href={source.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-text-quaternary hover:text-primary-mint transition-colors"
                            title="打开原始链接"
                        >
                            <ExternalLink size={14} />
                        </a>
                    )}
                </div>
                <h1 className="text-base font-semibold text-text leading-tight">{source.title}</h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-text-quaternary">
                    {source.author && <span>{source.author}</span>}
                    {source.date && <span>{source.date}</span>}
                    {source.wordCount != null && <span>{source.wordCount.toLocaleString()} 字</span>}
                </div>
            </div>

            {/* Search bar */}
            {searchOpen && (
                <SearchBar
                    term={searchTerm}
                    setTerm={setSearchTerm}
                    matchIndex={matchIndex}
                    setMatchIndex={setMatchIndex}
                    totalMatches={totalMatches}
                    onClose={() => { setSearchOpen(false); setSearchTerm('') }}
                />
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Guide card */}
                <div className="mx-3 mt-3 mb-2 rounded-xl border border-border bg-bg-container overflow-hidden">
                    <button
                        onClick={() => setGuideCollapsed((v) => !v)}
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-fill-secondary/50 transition-colors"
                    >
                        <div className="flex items-center gap-1.5">
                            <BookOpen size={13} className="text-primary-mint" />
                            <span className="text-xs font-semibold text-text">来源指南</span>
                        </div>
                        {guideCollapsed ? (
                            <ChevronRight size={13} className="text-text-quaternary" />
                        ) : (
                            <ChevronDown size={13} className="text-text-quaternary" />
                        )}
                    </button>
                    {!guideCollapsed && (
                        <div className="border-t border-border">
                            <GuideView guide={guide} loading={guideLoading} onGenerate={handleGenerateGuide} />
                        </div>
                    )}
                </div>

                {/* Raw content */}
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-text-quaternary">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                ) : (
                    <ContentView content={content ?? ''} searchTerm={searchTerm} matchIndex={matchIndex} />
                )}
            </div>
        </div>
    )
}

// ── Guide sub-view ──────────────────────────────────────────────────────────

const GuideView: React.FC<{
    guide: SourceGuide | null
    loading: boolean
    onGenerate: () => void
}> = ({ guide, loading, onGenerate }) => {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-6 text-text-quaternary">
                <Loader2 size={14} className="animate-spin mr-1.5" />
                <span className="text-xs">正在生成摘要…</span>
            </div>
        )
    }

    if (!guide) {
        return (
            <div className="flex items-center justify-between px-3 py-2.5">
                <p className="text-xs text-text-tertiary">尚未生成摘要</p>
                <button
                    onClick={onGenerate}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-primary-mint text-white rounded-lg hover:bg-primary-mint/90 transition-colors"
                >
                    <Sparkles size={11} />
                    生成
                </button>
            </div>
        )
    }

    return (
        <div className="px-3 py-2.5 space-y-2">
            {/* Summary */}
            <p className="text-[12px] text-text leading-relaxed markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide.summary}</ReactMarkdown>
            </p>

            {/* Suggested questions */}
            {guide.suggestedQuestions.length > 0 && (
                <SuggestedQuestions questions={guide.suggestedQuestions} />
            )}
        </div>
    )
}

// ── Suggested questions sub-component ─────────────────────────────────────────

const SuggestedQuestions: React.FC<{ questions: string[] }> = ({ questions }) => {
    const { setNotebookChatInput } = useAppStore()
    return (
        <div className="flex flex-wrap gap-1">
            {questions.map((q, i) => (
                <button
                    key={i}
                    onClick={() => setNotebookChatInput(q)}
                    className="text-[11px] text-text-secondary hover:text-primary-mint bg-fill-secondary hover:bg-primary-mint/8 border border-border rounded-full px-2.5 py-0.5 transition-colors truncate max-w-[160px]"
                    title={q}
                >
                    {q}
                </button>
            ))}
        </div>
    )
}

// ── Content sub-view with search highlighting ───────────────────────────────

function countMatches(text: string, term: string): number {
    if (!term) return 0
    const lower = text.toLowerCase()
    const tl = term.toLowerCase()
    let count = 0, idx = 0
    while ((idx = lower.indexOf(tl, idx)) !== -1) { count++; idx += tl.length }
    return count
}

function highlightText(text: string, term: string, activeIdx: number): React.ReactNode[] {
    if (!term) return [text]
    const lower = text.toLowerCase()
    const tl = term.toLowerCase()
    const parts: React.ReactNode[] = []
    let last = 0, matchNum = 0
    let idx: number
    while ((idx = lower.indexOf(tl, last)) !== -1) {
        if (idx > last) parts.push(text.slice(last, idx))
        const isActive = matchNum === activeIdx
        parts.push(
            <mark
                key={`m-${matchNum}`}
                className={isActive ? 'bg-primary-mint/40 text-text rounded px-0.5' : 'bg-warning/30 text-text rounded px-0.5'}
                data-match-idx={matchNum}
            >
                {text.slice(idx, idx + term.length)}
            </mark>,
        )
        matchNum++
        last = idx + tl.length
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
}

const ContentView: React.FC<{ content: string; searchTerm?: string; matchIndex?: number }> = ({ content, searchTerm = '', matchIndex = 0 }) => {
    const containerRef = React.useRef<HTMLDivElement>(null)

    // Scroll active match into view
    React.useEffect(() => {
        if (!searchTerm || !containerRef.current) return
        const el = containerRef.current.querySelector(`[data-match-idx="${matchIndex}"]`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, [searchTerm, matchIndex])

    if (!content.trim()) {
        return (
            <div className="flex items-center justify-center py-16 text-text-quaternary text-sm">
                暂无内容
            </div>
        )
    }

    if (searchTerm) {
        return (
            <div className="p-4" ref={containerRef}>
                <pre className="text-sm text-text leading-relaxed whitespace-pre-wrap font-sans break-words">
                    {highlightText(content, searchTerm, matchIndex)}
                </pre>
            </div>
        )
    }

    return (
        <div className="p-4 markdown-content text-sm" ref={containerRef}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    )
}

// ── Search bar ──────────────────────────────────────────────────────────────

const SearchBar: React.FC<{
    term: string
    setTerm: (t: string) => void
    matchIndex: number
    setMatchIndex: (i: number) => void
    totalMatches: number
    onClose: () => void
}> = ({ term, setTerm, matchIndex, setMatchIndex, totalMatches, onClose }) => {
    const inputRef = React.useRef<HTMLInputElement>(null)

    React.useEffect(() => { inputRef.current?.focus() }, [])

    const prev = () => setMatchIndex(matchIndex <= 0 ? Math.max(totalMatches - 1, 0) : matchIndex - 1)
    const next = () => setMatchIndex(matchIndex >= totalMatches - 1 ? 0 : matchIndex + 1)

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-fill-secondary shrink-0">
            <Search size={13} className="text-text-tertiary shrink-0" />
            <input
                ref={inputRef}
                value={term}
                onChange={(e) => { setTerm(e.target.value); setMatchIndex(0) }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.shiftKey ? prev() : next() }
                    if (e.key === 'Escape') onClose()
                }}
                placeholder="搜索内容…"
                className="flex-1 bg-transparent text-sm focus:outline-none min-w-0"
            />
            {term && (
                <span className="text-[10px] text-text-tertiary whitespace-nowrap">
                    {totalMatches > 0 ? `${matchIndex + 1} / ${totalMatches}` : '无结果'}
                </span>
            )}
            <button onClick={prev} className="p-1 hover:bg-fill rounded transition-colors" title="上一个">
                <ChevronUp size={13} />
            </button>
            <button onClick={next} className="p-1 hover:bg-fill rounded transition-colors" title="下一个">
                <ChevronDown size={13} />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-fill rounded transition-colors" title="关闭搜索">
                <X size={13} />
            </button>
        </div>
    )
}
