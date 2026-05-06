/**
 * NotebookChatDrawer — 右侧浮动聊天抽屉
 * 可通过按钮唤起/收起；内嵌 ChatArea，支持 /命令 触发 Studio 生成。
 */
import React from 'react'
import { X, MessageSquare, Volume2, Brain, FileText, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { ChatArea } from '../ChatArea'
import { StudioActionModal } from './StudioActionModal'
import { ArtifactFloatPanel } from './ArtifactFloatPanel'
import { useAppStore } from '../../stores/useAppStore'
import type { Artifact } from '../../types'

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
    onClose: () => void
}

export const NotebookChatDrawer: React.FC<Props> = ({ notebook, onClose }) => {
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
        // overview is handled by the overview tab; no modal needed here
    }, [])

    const handleArtifactGenerated = (artifact: Artifact) => {
        setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)])
        setArtifactsExpanded(true)
    }

    return (
        <div className="flex flex-col h-full bg-bg-container border-l border-border overflow-hidden">
            {/* Header */}
            <div className="h-11 flex items-center gap-2 px-3 border-b border-border shrink-0 bg-bg-container/90 backdrop-blur-xl">
                <MessageSquare size={14} className="text-primary-mint shrink-0" />
                <span className="text-sm font-semibold flex-1 truncate">AI 助手</span>
                {/* Slash commands hint strip */}
                <div className="flex items-center gap-0.5 mr-1">
                    {NOTEBOOK_SLASH_COMMANDS.map((cmd) => (
                        <button
                            key={cmd.id}
                            onClick={() => handleSlashCommand(cmd.id)}
                            title={cmd.description}
                            className="p-1.5 rounded-lg text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors"
                        >
                            <cmd.icon size={13} />
                        </button>
                    ))}
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors shrink-0"
                    title="收起"
                >
                    <X size={14} />
                </button>
            </div>

            {/* ChatArea */}
            <div className="flex-1 overflow-hidden min-h-0">
                <ChatArea
                    slashCommands={NOTEBOOK_SLASH_COMMANDS}
                    onSlashCommand={handleSlashCommand}
                />
            </div>

            {/* Artifact float strip at the bottom */}
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

            {/* Studio action modal */}
            {modalAction && (
                <StudioActionModal
                    notebook={notebook}
                    type={modalAction}
                    open={!!modalAction}
                    onClose={() => setModalAction(null)}
                    onGenerated={handleArtifactGenerated}
                />
            )}
        </div>
    )
}
