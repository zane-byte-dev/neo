/**
 * NotebookChatDrawer — 文档 AI 助手面板
 *
 * 两类快捷操作：
 *   「文档改写」(edit)   → 打开 DocDiffModal，流式生成 → 行级 Diff → 接受/拒绝 → 保存
 *   「内容分析」(insight) → setPendingQuickReply，结果显示在对话框
 */
import React from 'react'
import { X, Wand2, AlignLeft, ListChecks, Languages, Minimize2, FileText, Sparkles, ChevronDown, ChevronUp, PenLine, Volume2, Brain, PenSquare, MessageSquareDot } from 'lucide-react'
import { ChatArea } from '../ChatArea'
import { StudioActionModal } from './StudioActionModal'
import { ArtifactFloatPanel } from './ArtifactFloatPanel'
import { DocDiffModal } from './DocDiffModal'
import { useAppStore } from '../../stores/useAppStore'
import { cn } from '../../lib/utils'
import type { Artifact, NoteEntry } from '../../types'

export interface SlashCommand {
    id: 'audio' | 'mindmap' | 'report' | 'overview'
    label: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    description: string
}

export const NOTEBOOK_SLASH_COMMANDS: SlashCommand[] = [
    { id: 'audio',    label: '音频概览',  icon: Volume2,   description: '生成对话式音频脚本' },
    { id: 'mindmap',  label: '思维导图',  icon: Brain,     description: '生成知识结构图' },
    { id: 'report',   label: '报告',       icon: FileText,  description: '生成简报/学习指南/FAQ' },
    { id: 'overview', label: '概览',       icon: Sparkles,  description: '刷新笔记本摘要' },
]

// ── 文档快捷操作 ──────────────────────────────────────────────────────────────
interface DocAction {
    id: string
    label: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    iconColor: string
    bg: string
    desc: string
    /** 'edit' → opens DocDiffModal; 'insight' → sends to chat */
    category: 'edit' | 'insight'
    buildPrompt: (title: string, content: string) => string
}

// Instruction suffix appended to 'edit' prompts so the AI returns only content
const EDIT_SUFFIX = '\n\n重要规则：只输出修改后的完整文章正文，不要添加任何解释、前缀、后缀或代码块包裹。'

const DOC_ACTIONS: DocAction[] = [
    // ── 文档改写（触发 Diff）──────────────────────────────────────────────
    {
        id: 'polish',
        label: '优化文档',
        icon: Wand2,
        iconColor: 'text-violet-500',
        bg: 'bg-violet-500/10',
        desc: '改善表达流畅度、逻辑结构与专业度',
        category: 'edit',
        buildPrompt: (title, content) =>
            `请优化以下文章「${title}」，改善表达流畅度、逻辑结构和整体专业度，保持原文意思不变。${EDIT_SUFFIX}\n\n---\n\n${content}`,
    },
    {
        id: 'format',
        label: '格式化',
        icon: AlignLeft,
        iconColor: 'text-blue-500',
        bg: 'bg-blue-500/10',
        desc: '规范 Markdown 格式、标题层级与排版',
        category: 'edit',
        buildPrompt: (title, content) =>
            `请对以下文章「${title}」进行 Markdown 格式规范化：统一标题层级、修正列表格式、整理代码块。${EDIT_SUFFIX}\n\n---\n\n${content}`,
    },
    {
        id: 'expand',
        label: '扩写改写',
        icon: PenLine,
        iconColor: 'text-teal-500',
        bg: 'bg-teal-500/10',
        desc: '补充细节，扩展内容或换一种写法',
        category: 'edit',
        buildPrompt: (title, content) =>
            `请对以下文章「${title}」进行扩写改写：补充细节、举例说明，使内容更丰富完整，保持原有观点和风格。${EDIT_SUFFIX}\n\n---\n\n${content}`,
    },
    // ── 内容分析（发送到对话）────────────────────────────────────────────
    {
        id: 'keypoints',
        label: '提取要点',
        icon: ListChecks,
        iconColor: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        desc: '列出文章核心论点与关键信息',
        category: 'insight',
        buildPrompt: (title, content) =>
            `请从以下文章「${title}」中提取核心论点、关键数据和重要结论，以条目列表呈现。\n\n---\n\n${content}`,
    },
    {
        id: 'translate',
        label: '翻译英文',
        icon: Languages,
        iconColor: 'text-amber-500',
        bg: 'bg-amber-500/10',
        desc: '将文章翻译为英文（在对话中查看）',
        category: 'insight',
        buildPrompt: (title, content) =>
            `请将以下文章「${title}」翻译为流畅自然的英文，保持原文结构与格式。\n\n---\n\n${content}`,
    },
    {
        id: 'tldr',
        label: 'TL;DR',
        icon: Minimize2,
        iconColor: 'text-rose-500',
        bg: 'bg-rose-500/10',
        desc: '生成简洁摘要（≤150 字）',
        category: 'insight',
        buildPrompt: (title, content) =>
            `请为以下文章「${title}」生成一段简洁的 TL;DR 摘要（不超过 150 字），概括核心内容。\n\n---\n\n${content}`,
    },
]

interface Props {
    notebook: string
    selectedNote?: NoteEntry | null
    fullContent?: string
    onClose: () => void
    /** Called when user applies AI edits — updates note in parent. */
    onNoteApply?: (noteId: string, newContent: string) => Promise<void>
}

export const NotebookChatDrawer: React.FC<Props> = ({ notebook, selectedNote, fullContent, onClose, onNoteApply }) => {
    const [modalAction, setModalAction] = React.useState<'audio' | 'mindmap' | 'report' | null>(null)
    const [artifacts, setArtifacts] = React.useState<Artifact[]>([])
    const [artifactsExpanded, setArtifactsExpanded] = React.useState(false)
    // Pending edit action that opens the diff modal
    const [diffAction, setDiffAction] = React.useState<{ action: DocAction; prompt: string } | null>(null)

    const { notebookArtifacts, setPendingQuickReply, activeChatId } = useAppStore()

    // Sync artifacts from store when drawer opens
    React.useEffect(() => {
        if (notebookArtifacts.length) setArtifacts(notebookArtifacts)
    }, [notebookArtifacts])

    const handleSlashCommand = React.useCallback((cmdId: string) => {
        if (cmdId === 'audio' || cmdId === 'mindmap' || cmdId === 'report') {
            setModalAction(cmdId)
        }
    }, [])

    const handleArtifactGenerated = (artifact: Artifact) => {
        setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)])
        setArtifactsExpanded(true)
    }

    // Run a doc action — route to diff modal (edit) or chat (insight)
    const runDocAction = (action: DocAction) => {
        if (!selectedNote) return
        const content = fullContent ?? selectedNote.content ?? ''
        const MAX_CHARS = 4000
        const truncated = content.length > MAX_CHARS
            ? content.slice(0, MAX_CHARS) + '\n\n[内容已截断…]'
            : content
        const prompt = action.buildPrompt(selectedNote.title, truncated)

        if (action.category === 'edit') {
            setDiffAction({ action, prompt })
        } else {
            if (!activeChatId) return
            setPendingQuickReply(prompt)
        }
    }

    const editActions = DOC_ACTIONS.filter(a => a.category === 'edit')
    const insightActions = DOC_ACTIONS.filter(a => a.category === 'insight')
    const hasDoc = Boolean(selectedNote)

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden">
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="h-10 flex items-center gap-2 px-3 border-b border-border/60 shrink-0">
                <Sparkles size={13} className="text-primary-mint shrink-0" />
                <span className="text-xs font-semibold text-text flex-1">文档助手</span>
                {selectedNote && (
                    <span className="flex items-center gap-1 bg-fill-secondary border border-border/60 rounded-full px-2 py-0.5 text-[10px] text-text-secondary max-w-[120px] truncate">
                        <FileText size={9} className="shrink-0 text-text-tertiary" />
                        <span className="truncate">{selectedNote.title}</span>
                    </span>
                )}
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors shrink-0"
                    title="收起"
                >
                    <X size={12} />
                </button>
            </div>

            {/* ── Doc quick actions ────────────────────────────────────────── */}
            {hasDoc && (
                <div className="shrink-0 border-b border-border/60 bg-fill-secondary/30">
                    <div className="px-2 pt-2 pb-2 space-y-2">
                        {/* Edit group */}
                        <div>
                            <div className="flex items-center gap-1 px-1 mb-1">
                                <PenSquare size={9} className="text-text-quaternary" />
                                <span className="text-[9px] text-text-quaternary font-medium tracking-wide">文档改写 · 支持逐行确认</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {editActions.map((action) => (
                                    <ActionButton key={action.id} action={action} onClick={() => runDocAction(action)} />
                                ))}
                            </div>
                        </div>
                        {/* Insight group */}
                        <div>
                            <div className="flex items-center gap-1 px-1 mb-1">
                                <MessageSquareDot size={9} className="text-text-quaternary" />
                                <span className="text-[9px] text-text-quaternary font-medium tracking-wide">内容分析 · 结果显示在对话</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {insightActions.map((action) => (
                                    <ActionButton key={action.id} action={action} onClick={() => runDocAction(action)} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Chat area ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden min-h-0">
                <ChatArea
                    slashCommands={NOTEBOOK_SLASH_COMMANDS}
                    onSlashCommand={handleSlashCommand}
                />
            </div>

            {/* ── Artifact strip ──────────────────────────────────────────── */}
            {artifacts.length > 0 && (
                <div className="border-t border-border shrink-0">
                    <button
                        onClick={() => setArtifactsExpanded((v) => !v)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-fill-secondary/50 transition-colors"
                    >
                        <Sparkles size={12} className="text-primary-mint" />
                        <span className="flex-1 text-left font-medium">生成内容 ({artifacts.length})</span>
                        {artifactsExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                    {artifactsExpanded && (
                        <ArtifactFloatPanel
                            notebook={notebook}
                            artifacts={artifacts}
                            onArtifactsChange={setArtifacts}
                        />
                    )}
                </div>
            )}

            {/* ── Studio action modal ─────────────────────────────────────── */}
            {modalAction && (
                <StudioActionModal
                    notebook={notebook}
                    type={modalAction}
                    open={!!modalAction}
                    onClose={() => setModalAction(null)}
                    onGenerated={handleArtifactGenerated}
                />
            )}

            {/* ── Diff modal (edit actions) ───────────────────────────────── */}
            {diffAction && selectedNote && (
                <DocDiffModal
                    note={selectedNote}
                    actionLabel={diffAction.action.label}
                    prompt={diffAction.prompt}
                    onApply={async (noteId, newContent) => {
                        if (onNoteApply) await onNoteApply(noteId, newContent)
                    }}
                    onClose={() => setDiffAction(null)}
                />
            )}
        </div>
    )
}

// ── Reusable action button ────────────────────────────────────────────────────

const ActionButton: React.FC<{ action: DocAction; onClick: () => void }> = ({ action, onClick }) => (
    <button
        onClick={onClick}
        title={action.desc}
        className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left hover:opacity-80 active:scale-95 transition-all',
            action.bg,
        )}
    >
        <action.icon size={11} className={cn('shrink-0', action.iconColor)} />
        <span className={cn('text-[11px] font-medium truncate', action.iconColor)}>{action.label}</span>
    </button>
)
