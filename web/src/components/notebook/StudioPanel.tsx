/**
 * StudioPanel — right column: Studio card grid + document tools + modal actions.
 * Two sections: 内容生成 (notebook-level) + 文档工具 (doc-level when note selected).
 */
import React from 'react'
import { StickyNote, Volume2, Brain, FileText, Sparkles, ChevronRight, ArrowLeft, Wand2, AlignLeft, ListChecks, Languages, Minimize2, PenLine, BookOpen } from 'lucide-react'
import type { Artifact, NoteEntry } from '../../types'
import { StudioActionModal } from './StudioActionModal'
import { OverviewTab } from './studio/OverviewTab'
import { NotesTab } from './studio/NotesTab'
import { StudioOutputs } from './studio/StudioOutputs'
import { ArtifactViewer } from './studio/ArtifactViewer'
import { useAppStore } from '../../stores/useAppStore'
import { cn } from '../../lib/utils'

type View = 'home' | 'overview' | 'notes' | 'artifact-view'
type ModalAction = 'audio' | 'mindmap' | 'report' | null

interface Props { notebook: string; hideHeader?: boolean }

// ── 笔记本内容生成卡片 ────────────────────────────────────────────────────────
interface StudioCard {
    id: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    desc: string
    bg: string
    iconColor: string
    action: 'modal' | 'view'
    modalType?: 'audio' | 'mindmap' | 'report'
    viewId?: View
}

const GENERATE_CARDS: StudioCard[] = [
    { id: 'audio',    icon: Volume2,    label: '音频概览', desc: '生成对话式播客脚本',    bg: 'bg-green-50 dark:bg-green-950/30',   iconColor: 'text-green-600 dark:text-green-400',   action: 'modal', modalType: 'audio' },
    { id: 'mindmap',  icon: Brain,      label: '思维导图', desc: '生成知识结构图',         bg: 'bg-purple-50 dark:bg-purple-950/30',  iconColor: 'text-purple-600 dark:text-purple-400', action: 'modal', modalType: 'mindmap' },
    { id: 'report',   icon: FileText,   label: '报告',     desc: '简报/学习指南/FAQ',      bg: 'bg-blue-50 dark:bg-blue-950/30',     iconColor: 'text-blue-600 dark:text-blue-400',    action: 'modal', modalType: 'report' },
    { id: 'overview', icon: Sparkles,   label: '概览',     desc: '刷新笔记本摘要',         bg: 'bg-amber-50 dark:bg-amber-950/30',   iconColor: 'text-amber-600 dark:text-amber-400',  action: 'view',  viewId: 'overview' },
    { id: 'notes',    icon: StickyNote, label: '笔记',     desc: '管理 AI 与手动笔记',     bg: 'bg-rose-50 dark:bg-rose-950/30',     iconColor: 'text-rose-600 dark:text-rose-400',    action: 'view',  viewId: 'notes' },
]

// ── 文档工具定义 ──────────────────────────────────────────────────────────────
interface DocTool {
    id: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    desc: string
    iconColor: string
    buildPrompt: (title: string, content: string) => string
}

const DOC_TOOLS: DocTool[] = [
    {
        id: 'polish',
        icon: Wand2,
        label: '优化文档',
        desc: '改善表达流畅度与结构',
        iconColor: 'text-violet-500',
        buildPrompt: (title, content) =>
            `请优化以下文章「${title}」，改善表达流畅度、逻辑结构和整体专业度，保持原文意思不变，返回优化后的完整文章。\n\n---\n\n${content}`,
    },
    {
        id: 'format',
        icon: AlignLeft,
        label: '格式化',
        desc: '规范 Markdown 格式与排版',
        iconColor: 'text-blue-500',
        buildPrompt: (title, content) =>
            `请对以下文章「${title}」进行 Markdown 格式规范化：统一标题层级、修正列表格式、整理代码块，输出完整规范的文档。\n\n---\n\n${content}`,
    },
    {
        id: 'keypoints',
        icon: ListChecks,
        label: '提取要点',
        desc: '列出核心论点与关键信息',
        iconColor: 'text-emerald-500',
        buildPrompt: (title, content) =>
            `请从以下文章「${title}」中提取核心论点、关键数据和重要结论，以条目列表呈现。\n\n---\n\n${content}`,
    },
    {
        id: 'translate',
        icon: Languages,
        label: '翻译英文',
        desc: '将文章翻译为流畅英文',
        iconColor: 'text-amber-500',
        buildPrompt: (title, content) =>
            `请将以下文章「${title}」翻译为流畅自然的英文，保持原文结构与格式。\n\n---\n\n${content}`,
    },
    {
        id: 'tldr',
        icon: Minimize2,
        label: 'TL;DR',
        desc: '生成简洁摘要（不超过150字）',
        iconColor: 'text-rose-500',
        buildPrompt: (title, content) =>
            `请为以下文章「${title}」生成一段简洁的 TL;DR 摘要（不超过 150 字），概括核心内容。\n\n---\n\n${content}`,
    },
    {
        id: 'expand',
        icon: PenLine,
        label: '扩写改写',
        desc: '补充细节或换种写法',
        iconColor: 'text-teal-500',
        buildPrompt: (title, content) =>
            `请对以下文章「${title}」进行扩写改写：补充细节、举例说明，使内容更丰富完整，保持原有观点和风格。\n\n---\n\n${content}`,
    },
]

export const StudioPanel: React.FC<Props> = ({ notebook, hideHeader }) => {
    const [view, setView] = React.useState<View>('home')
    const [modalAction, setModalAction] = React.useState<ModalAction>(null)
    const [viewingArtifact, setViewingArtifact] = React.useState<Artifact | null>(null)
    const [refreshKey, setRefreshKey] = React.useState(0)

    const { selectedNote, setPendingQuickReply, activeChatId } = useAppStore()

    const openArtifact = (a: Artifact) => {
        setViewingArtifact(a)
        setView('artifact-view')
    }

    const handleCardClick = (card: StudioCard) => {
        if (card.action === 'modal' && card.modalType) {
            setModalAction(card.modalType)
        } else if (card.action === 'view' && card.viewId) {
            setView(card.viewId)
        }
    }

    const handleGenerated = (artifact: Artifact) => {
        setRefreshKey((k) => k + 1)
        openArtifact(artifact)
    }

    const runDocTool = (tool: DocTool, note: NoteEntry, content: string) => {
        if (!activeChatId) return
        const MAX = 4000
        const truncated = content.length > MAX ? content.slice(0, MAX) + '\n\n[内容已截断…]' : content
        setPendingQuickReply(tool.buildPrompt(note.title, truncated))
    }

    if (view === 'artifact-view' && viewingArtifact) {
        return (
            <div className="flex flex-col h-full bg-bg-container">
                <ArtifactViewer
                    artifact={viewingArtifact}
                    onBack={() => { setViewingArtifact(null); setView('home') }}
                    onRegenerate={(type) => {
                        setViewingArtifact(null)
                        setView('home')
                        setModalAction(type as ModalAction)
                    }}
                />
            </div>
        )
    }

    if (view === 'overview' || view === 'notes') {
        const label = view === 'overview' ? '概览' : '笔记'
        return (
            <div className="flex flex-col h-full bg-bg-container">
                <SubViewHeader label={label} onBack={() => setView('home')} />
                <div className="flex-1 overflow-hidden">
                    {view === 'overview' && <OverviewTab notebook={notebook} />}
                    {view === 'notes'    && <NotesTab notebook={notebook} />}
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-y-auto custom-scrollbar">
            {!hideHeader && (
                <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0 sticky top-0 bg-bg-container z-10">
                    <Sparkles size={15} className="text-primary-mint" />
                    <span className="text-sm font-semibold">Studio</span>
                </div>
            )}

            {/* ── 文档工具 (当选中文章时显示) ─────────────────────────────── */}
            {selectedNote ? (
                <div className="px-3 pt-3 pb-2 shrink-0">
                    <div className="flex items-center gap-1.5 mb-2">
                        <BookOpen size={11} className="text-text-tertiary" />
                        <span className="text-[11px] font-semibold text-text-secondary">文档工具</span>
                        <span className="text-[10px] text-text-quaternary truncate max-w-[120px]">· {selectedNote.title}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {DOC_TOOLS.map((tool) => (
                            <button
                                key={tool.id}
                                onClick={() => runDocTool(tool, selectedNote, selectedNote.content ?? '')}
                                title={tool.desc}
                                className="flex items-start gap-2 p-2.5 rounded-xl border border-border hover:border-border/80 hover:bg-fill-secondary/60 active:scale-[0.97] transition-all text-left group"
                                style={{ boxShadow: 'var(--shadow-soft)' }}
                            >
                                <div className="mt-0.5 shrink-0">
                                    <tool.icon size={13} className={cn(tool.iconColor)} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[11px] font-semibold text-text leading-tight">{tool.label}</div>
                                    <div className="text-[10px] text-text-tertiary leading-tight mt-0.5 line-clamp-1">{tool.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="px-3 pt-3 pb-2 shrink-0">
                    <div className="flex items-center gap-1.5 mb-2">
                        <BookOpen size={11} className="text-text-quaternary" />
                        <span className="text-[11px] font-semibold text-text-tertiary">文档工具</span>
                    </div>
                    <div className="rounded-xl border border-dashed border-border px-3 py-3 text-center">
                        <p className="text-[11px] text-text-quaternary leading-relaxed">从左侧选择一篇文章<br />即可解锁文档工具</p>
                    </div>
                </div>
            )}

            {/* ── 内容生成 ─────────────────────────────────────────────────── */}
            <div className="px-3 pt-1 pb-2 shrink-0">
                <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles size={11} className="text-text-tertiary" />
                    <span className="text-[11px] font-semibold text-text-secondary">内容生成</span>
                    <span className="text-[10px] text-text-quaternary">· 基于所有来源</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {GENERATE_CARDS.map((card) => (
                        <button
                            key={card.id}
                            onClick={() => handleCardClick(card)}
                            className={cn(
                                'rounded-xl p-3 text-left hover:opacity-80 active:scale-[0.97] transition-all group',
                                card.bg,
                            )}
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <card.icon size={15} className={card.iconColor} />
                                <ChevronRight size={12} className="text-text-quaternary group-hover:text-text-tertiary transition-colors" />
                            </div>
                            <div className="text-xs font-semibold text-text leading-tight">{card.label}</div>
                            <div className="text-[10px] text-text-tertiary mt-0.5 leading-tight line-clamp-1">{card.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── 生成内容 outputs ─────────────────────────────────────────── */}
            <div className="flex-1 min-h-0">
                <StudioOutputs key={refreshKey} notebook={notebook} onViewArtifact={openArtifact} />
            </div>

            {/* ── 笔记入口 ─────────────────────────────────────────────────── */}
            <div className="p-3 shrink-0 sticky bottom-0 bg-bg-container border-t border-border/60">
                <button
                    onClick={() => setView('notes')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-text text-bg rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                >
                    <StickyNote size={14} /> 添加笔记
                </button>
            </div>

            {/* Generation modals */}
            {modalAction && (
                <StudioActionModal
                    notebook={notebook}
                    type={modalAction}
                    open={true}
                    onClose={() => setModalAction(null)}
                    onGenerated={handleGenerated}
                />
            )}
        </div>
    )
}

// ── Sub-view header with back button ────────────────────────────────────────

const SubViewHeader: React.FC<{ label: string; onBack: () => void }> = ({ label, onBack }) => (
    <div className="h-14 border-b border-border flex items-center gap-2 px-3 shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary transition-colors">
            <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-semibold">{label}</span>
    </div>
)

