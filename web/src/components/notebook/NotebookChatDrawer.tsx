/**
 * NotebookChatDrawer — 文档 AI 助手面板
 *
 * 快捷操作（优化、翻译等）已迁移到 NoteEditor 的更多菜单和资源面板。
 * 本组件仅保留：对话区域、生成内容面板、StudioActionModal。
 */
import React from 'react'
import { X, FileText, Sparkles, ChevronDown, ChevronUp, Volume2, Brain } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import type { Artifact, NoteEntry } from '../../types'

const ArtifactFloatPanel = React.lazy(() => import('./ArtifactFloatPanel').then((mod) => ({ default: mod.ArtifactFloatPanel })))
const ChatArea = React.lazy(() => import('../ChatArea').then((mod) => ({ default: mod.ChatArea })))
const StudioActionModal = React.lazy(() => import('./StudioActionModal').then((mod) => ({ default: mod.StudioActionModal })))

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

interface Props {
    notebook: string
    selectedNote?: NoteEntry | null
    fullContent?: string
    onClose: () => void
}

export const NotebookChatDrawer: React.FC<Props> = ({ notebook, selectedNote, onClose }) => {
    const [modalAction, setModalAction] = React.useState<'audio' | 'mindmap' | 'report' | null>(null)
    const [artifacts, setArtifacts] = React.useState<Artifact[]>([])
    const [artifactsExpanded, setArtifactsExpanded] = React.useState(false)

    const { notebookArtifacts } = useAppStore()

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

            {/* ── Chat area ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden min-h-0">
                <React.Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-text-tertiary">加载对话...</div>}>
                    <ChatArea
                        slashCommands={NOTEBOOK_SLASH_COMMANDS}
                        onSlashCommand={handleSlashCommand}
                    />
                </React.Suspense>
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
                        <React.Suspense fallback={<div className="py-4 text-center text-xs text-text-tertiary">加载生成内容...</div>}>
                            <ArtifactFloatPanel
                                notebook={notebook}
                                artifacts={artifacts}
                                onArtifactsChange={setArtifacts}
                            />
                        </React.Suspense>
                    )}
                </div>
            )}

            {/* ── Studio action modal ─────────────────────────────────────── */}
            {modalAction && (
                <React.Suspense fallback={null}>
                    <StudioActionModal
                        notebook={notebook}
                        type={modalAction}
                        open={!!modalAction}
                        onClose={() => setModalAction(null)}
                        onGenerated={handleArtifactGenerated}
                    />
                </React.Suspense>
            )}
        </div>
    )
}
