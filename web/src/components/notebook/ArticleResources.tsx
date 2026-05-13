import React from 'react'
import { Brain, ChevronRight, FileText, Layers, Loader2, Play, Plus, Sparkles, Volume2 } from 'lucide-react'
import type { Artifact, ArtifactType } from '../../types'
import { cn } from '../../lib/utils'
import type { AudioLine } from './AudioOverview'

export type ArticleResourceType = Extract<ArtifactType, 'audio' | 'mindmap' | 'report'>
export type SummaryResourceState = 'empty' | 'generating' | 'done'

interface ArticleResourceStatusStripProps {
    summaryState: SummaryResourceState
    articleArtifacts: Artifact[]
    libraryArtifactCount: number
    loading?: boolean
    onShowSummary: () => void
    onGenerateSummary: () => void
    onOpenArtifact: (artifact: Artifact) => void
    onGenerateArtifact: (type: ArticleResourceType) => void
    onOpenLibrary: () => void
}

interface ArticleResourceSectionProps {
    articleArtifacts: Artifact[]
    libraryArtifactCount: number
    loading?: boolean
    onOpenArtifact: (artifact: Artifact) => void
    onGenerateArtifact: (type: ArticleResourceType) => void
    onOpenLibrary: () => void
}

const RESOURCE_META: Record<ArticleResourceType, {
    label: string
    generateLabel: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    color: string
    bg: string
}> = {
    audio: {
        label: '音频概览',
        generateLabel: '音频',
        icon: Volume2,
        color: 'text-green-600 dark:text-green-400',
        bg: 'bg-green-50 dark:bg-green-950/25',
    },
    mindmap: {
        label: '思维导图',
        generateLabel: '导图',
        icon: Brain,
        color: 'text-purple-600 dark:text-purple-400',
        bg: 'bg-purple-50 dark:bg-purple-950/25',
    },
    report: {
        label: '报告',
        generateLabel: '报告',
        icon: FileText,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-50 dark:bg-blue-950/25',
    },
}

const RESOURCE_TYPES: ArticleResourceType[] = ['audio', 'mindmap', 'report']

export function sourceIdFromArticleId(articleId: string | null | undefined): string | null {
    if (!articleId) return null
    const last = articleId.split('/').pop()
    if (!last) return null
    return last.replace(/\.md$/, '')
}

export function isArticleArtifact(artifact: Artifact, articleId: string | null | undefined): boolean {
    if (!articleId) return false
    if (artifact.primaryArticleId) return artifact.primaryArticleId === articleId
    const articleSourceId = sourceIdFromArticleId(articleId)
    return !!articleSourceId && artifact.sourceIds?.length === 1 && artifact.sourceIds[0] === articleSourceId
}

export function filterArticleArtifacts(artifacts: Artifact[], articleId: string | null | undefined): Artifact[] {
    return artifacts.filter((artifact) => isArticleArtifact(artifact, articleId))
}

export const ArticleResourceStatusStrip: React.FC<ArticleResourceStatusStripProps> = ({
    summaryState,
    articleArtifacts,
    libraryArtifactCount,
    loading,
    onShowSummary,
    onGenerateSummary,
    onOpenArtifact,
    onGenerateArtifact,
    onOpenLibrary,
}) => {
    return (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-fill-secondary/35 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary mr-1">
                <Layers size={12} className="text-primary-mint" />
                相关资源
            </span>
            <ResourceChip
                icon={Sparkles}
                label={summaryState === 'done' ? '摘要已生成' : summaryState === 'generating' ? '摘要生成中' : '生成摘要'}
                active={summaryState === 'done'}
                disabled={summaryState === 'generating'}
                loading={summaryState === 'generating'}
                onClick={summaryState === 'done' ? onShowSummary : onGenerateSummary}
            />
            {RESOURCE_TYPES.map((type) => {
                const artifacts = articleArtifacts.filter((artifact) => artifact.type === type)
                const firstArtifact = artifacts[0]
                const meta = RESOURCE_META[type]
                return (
                    <ResourceChip
                        key={type}
                        icon={meta.icon}
                        iconClassName={meta.color}
                        label={firstArtifact ? `${meta.label} ${artifacts.length}` : `生成${meta.generateLabel}`}
                        active={!!firstArtifact}
                        onClick={() => firstArtifact ? onOpenArtifact(firstArtifact) : onGenerateArtifact(type)}
                    />
                )
            })}
            {libraryArtifactCount > 0 && (
                <ResourceChip
                    icon={Layers}
                    label={`资源库 ${libraryArtifactCount}`}
                    onClick={onOpenLibrary}
                />
            )}
            {loading && <Loader2 size={12} className="ml-auto animate-spin text-text-quaternary" />}
        </div>
    )
}

export const ArticleResourceSection: React.FC<ArticleResourceSectionProps> = ({
    articleArtifacts,
    libraryArtifactCount,
    loading,
    onOpenArtifact,
    onGenerateArtifact,
    onOpenLibrary,
}) => {
    const visibleArtifacts = articleArtifacts.slice(0, 6)
    const hiddenCount = Math.max(0, articleArtifacts.length - visibleArtifacts.length)

    return (
        <section className="mt-10 border-t border-border/70 pt-6">
            <div className="mb-3 flex items-center gap-2">
                <Layers size={14} className="text-primary-mint" />
                <h2 className="text-sm font-semibold text-text flex-1">本篇资源</h2>
                <span className="text-[11px] text-text-quaternary">{articleArtifacts.length} 项</span>
            </div>

            {loading ? (
                <div className="rounded-lg border border-border bg-fill-secondary/25 px-3 py-4 text-[12px] text-text-tertiary flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin text-primary-mint" />
                    正在加载资源…
                </div>
            ) : articleArtifacts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-fill-secondary/25 px-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-medium text-text-secondary flex-1 min-w-[120px]">本篇暂无资源</span>
                        {RESOURCE_TYPES.map((type) => {
                            const meta = RESOURCE_META[type]
                            return (
                                <button
                                    key={type}
                                    onClick={() => onGenerateArtifact(type)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-container px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-primary-mint/40 hover:text-primary-mint transition-colors"
                                >
                                    <Plus size={11} />
                                    {meta.generateLabel}
                                </button>
                            )
                        })}
                        {libraryArtifactCount > 0 && (
                            <button
                                onClick={onOpenLibrary}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-container px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-primary-mint/40 hover:text-primary-mint transition-colors"
                            >
                                <Layers size={11} />
                                资源库 {libraryArtifactCount}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {visibleArtifacts.map((artifact) => (
                        <ArticleResourceCard
                            key={artifact.id}
                            artifact={artifact}
                            onOpen={() => onOpenArtifact(artifact)}
                        />
                    ))}
                    {hiddenCount > 0 && (
                        <button
                            onClick={onOpenLibrary}
                            className="rounded-lg border border-dashed border-border px-3 py-3 text-left text-[12px] text-text-tertiary hover:border-primary-mint/40 hover:text-primary-mint transition-colors"
                        >
                            还有 {hiddenCount} 项 · 查看资源库
                        </button>
                    )}
                </div>
            )}
        </section>
    )
}

const ResourceChip: React.FC<{
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    active?: boolean
    disabled?: boolean
    loading?: boolean
    iconClassName?: string
    onClick: () => void
}> = ({ icon: Icon, label, active, disabled, loading, iconClassName, onClick }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            active
                ? 'border-primary-mint/35 bg-primary-mint/8 text-primary-mint'
                : 'border-border bg-bg-container text-text-secondary hover:border-primary-mint/35 hover:text-primary-mint',
        )}
    >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} className={iconClassName} />}
        {label}
    </button>
)

const ArticleResourceCard: React.FC<{ artifact: Artifact; onOpen: () => void }> = ({ artifact, onOpen }) => {
    const type = artifact.type as ArticleResourceType
    const meta = RESOURCE_META[type]
    const Icon = meta?.icon ?? Sparkles
    const preview = buildPreview(artifact)
    const createdAt = formatDate(artifact.createdAt)

    return (
        <button
            onClick={onOpen}
            className={cn(
                'group rounded-lg border border-border p-3 text-left transition-colors hover:border-primary-mint/35 hover:bg-fill-secondary/35',
                meta?.bg,
            )}
        >
            <div className="flex items-center gap-2">
                <Icon size={14} className={meta?.color ?? 'text-primary-mint'} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{artifact.title}</span>
                <ChevronRight size={13} className="shrink-0 text-text-quaternary group-hover:text-primary-mint transition-colors" />
            </div>
            <div className="mt-1 text-[11px] text-text-quaternary">
                {createdAt}{artifact.subtype ? ` · ${artifact.subtype}` : ''}
            </div>
            <ResourcePreviewBody artifact={artifact} preview={preview} />
        </button>
    )
}

const ResourcePreviewBody: React.FC<{ artifact: Artifact; preview: string[] }> = ({ artifact, preview }) => {
    if (artifact.type === 'audio') {
        const script = getAudioScript(artifact)
        const minutes = estimateAudioMinutes(script)
        return (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-text-secondary">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                    <Play size={13} fill="currentColor" />
                </span>
                <span className="flex-1 truncate">{script.length} 段 · 约 {minutes} 分钟</span>
            </div>
        )
    }

    if (artifact.type === 'mindmap') {
        return (
            <div className="mt-3 space-y-1">
                {preview.map((line, index) => (
                    <div key={index} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500/70" />
                        <span className="truncate">{line}</span>
                    </div>
                ))}
            </div>
        )
    }

    return <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed text-text-secondary">{preview[0] || '暂无预览'}</p>
}

function buildPreview(artifact: Artifact): string[] {
    if (artifact.type === 'mindmap') {
        const markdown = getMarkdown(artifact)
        const headings = markdown
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => /^#{1,4}\s+/.test(line))
            .map((line) => line.replace(/^#{1,4}\s+/, '').trim())
            .filter(Boolean)
        return headings.slice(0, 4)
    }

    if (artifact.type === 'report') {
        const plain = stripMarkdown(getMarkdown(artifact))
        return [plain.slice(0, 180)]
    }

    return []
}

function getMarkdown(artifact: Artifact): string {
    return typeof artifact.data.markdown === 'string' ? artifact.data.markdown : ''
}

function stripMarkdown(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`>#-]/g, '')
        .replace(/\[[^\]]+\]\([^)]+\)/g, (match) => match.replace(/^\[|\]\([^)]+\)$/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
}

function getAudioScript(artifact: Artifact): AudioLine[] {
    const value = Array.isArray(artifact.data.script)
        ? artifact.data.script
        : Array.isArray(artifact.data.segments)
            ? artifact.data.segments
            : []
    return value.filter((line): line is AudioLine => {
        if (!line || typeof line !== 'object') return false
        const candidate = line as Record<string, unknown>
        return (candidate.speaker === 'A' || candidate.speaker === 'B') && typeof candidate.text === 'string'
    })
}

function estimateAudioMinutes(script: AudioLine[]): number {
    const chars = script.reduce((total, line) => total + line.text.length, 0)
    return Math.max(1, Math.ceil(chars / 260))
}

function formatDate(value: string | number): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '未知时间'
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}