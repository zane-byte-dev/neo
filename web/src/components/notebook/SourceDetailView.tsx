/**
 * SourceDetailView — full-width source content viewer.
 * Shown in the middle column when a source is clicked.
 */
import React from 'react'
import { ArrowLeft, FileText, Link as LinkIcon, Youtube, Type, Loader2, Sparkles, ExternalLink, BookOpen, HelpCircle } from 'lucide-react'
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
    const [activeTab, setActiveTab] = React.useState<'content' | 'guide'>('guide')

    const guide = sourceGuides[source.id] ?? null

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
            setActiveTab('guide')
        } catch { /* ignore */ }
        finally { setGuideLoading(false) }
    }

    const Icon = TYPE_ICON[source.type] ?? FileText

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border shrink-0 bg-bg-container">
                <div className="flex items-center gap-2 mb-2">
                    <button onClick={onBack} className="p-1 hover:bg-fill-secondary rounded-lg transition-colors" title="返回对话">
                        <ArrowLeft size={16} />
                    </button>
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

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
                {([
                    ['guide', BookOpen, '摘要与要点'],
                    ['content', FileText, '原文内容'],
                ] as const).map(([tab, TabIcon, label]) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                            activeTab === tab
                                ? 'border-primary-mint text-primary-mint'
                                : 'border-transparent text-text-tertiary hover:text-text-secondary'
                        }`}
                    >
                        <TabIcon size={13} />
                        {label}
                    </button>
                ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-text-quaternary">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                ) : activeTab === 'guide' ? (
                    <GuideView guide={guide} loading={guideLoading} onGenerate={handleGenerateGuide} />
                ) : (
                    <ContentView content={content ?? ''} />
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
            <div className="flex items-center justify-center py-16 text-text-quaternary">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-sm">正在生成摘要…</span>
            </div>
        )
    }

    if (!guide) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <Sparkles size={28} className="text-text-quaternary mb-3" />
                <p className="text-sm text-text-tertiary mb-4">尚未生成摘要，AI 将分析此来源并提取关键信息。</p>
                <button
                    onClick={onGenerate}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-mint text-white rounded-xl hover:bg-primary-mint/90 transition-colors"
                >
                    <Sparkles size={14} />
                    生成摘要
                </button>
            </div>
        )
    }

    return (
        <div className="p-4 space-y-5">
            {/* Summary */}
            <section>
                <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">摘要</h3>
                <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">{guide.summary}</p>
            </section>

            {/* Key topics */}
            {guide.keyTopics.length > 0 && (
                <section>
                    <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">关键主题</h3>
                    <div className="flex flex-wrap gap-2">
                        {guide.keyTopics.map((topic, i) => (
                            <span key={i} className="text-xs bg-primary-mint/10 text-primary-mint px-2.5 py-1 rounded-lg">
                                {topic}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {/* Suggested questions */}
            {guide.suggestedQuestions.length > 0 && (
                <section>
                    <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">建议提问</h3>
                    <div className="space-y-2">
                        {guide.suggestedQuestions.map((q, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                                <HelpCircle size={14} className="text-text-quaternary mt-0.5 shrink-0" />
                                <span>{q}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Generated at */}
            {guide.generatedAt && (
                <p className="text-[10px] text-text-quaternary pt-2">
                    生成于 {new Date(guide.generatedAt).toLocaleString('zh-CN')}
                </p>
            )}
        </div>
    )
}

// ── Content sub-view ────────────────────────────────────────────────────────

const ContentView: React.FC<{ content: string }> = ({ content }) => {
    if (!content.trim()) {
        return (
            <div className="flex items-center justify-center py-16 text-text-quaternary text-sm">
                暂无内容
            </div>
        )
    }

    return (
        <div className="p-4">
            <pre className="text-sm text-text leading-relaxed whitespace-pre-wrap font-sans break-words">
                {content}
            </pre>
        </div>
    )
}
