/**
 * ArtifactFloatPanel — 内嵌于聊天抽屉底部的 artifacts 列表面板。
 * 展示生成的音频、思维导图、报告等，点击可查看详情（覆盖整个抽屉）。
 */
import React from 'react'
import { Brain, Volume2, FileText, Sparkles, Trash2, ArrowLeft } from 'lucide-react'
import { notebookListArtifacts, notebookDeleteArtifact } from '../../api'
import { confirm } from '../ConfirmDialog'
import { cn } from '../../lib/utils'
import type { Artifact } from '../../types'

const ArtifactViewer = React.lazy(() => import('./studio/ArtifactViewer').then((mod) => ({ default: mod.ArtifactViewer })))
const StudioActionModal = React.lazy(() => import('./StudioActionModal').then((mod) => ({ default: mod.StudioActionModal })))

interface Props {
    notebook: string
    artifacts: Artifact[]
    onArtifactsChange: (artifacts: Artifact[]) => void
}

export const ArtifactFloatPanel: React.FC<Props> = ({ notebook, artifacts, onArtifactsChange }) => {
    const [viewing, setViewing] = React.useState<Artifact | null>(null)
    const [regenerating, setRegenerating] = React.useState<'audio' | 'mindmap' | 'report' | null>(null)

    // Refresh from server
    const reload = React.useCallback(() => {
        notebookListArtifacts(notebook).then(onArtifactsChange).catch(() => {})
    }, [notebook, onArtifactsChange])

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (!(await confirm('删除此生成内容？', { destructive: true, confirmText: '删除' }))) return
        await notebookDeleteArtifact(notebook, id)
        reload()
        if (viewing?.id === id) setViewing(null)
    }

    if (viewing) {
        return (
            <div className="max-h-80 flex flex-col overflow-hidden bg-bg-container">
                <div className="h-9 flex items-center gap-2 px-3 border-b border-border shrink-0">
                    <button
                        onClick={() => setViewing(null)}
                        className="p-1 rounded hover:bg-fill transition-colors text-text-secondary"
                    >
                        <ArrowLeft size={13} />
                    </button>
                    <span className="text-xs font-medium flex-1 truncate">{viewing.title}</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <React.Suspense fallback={<div className="py-8 text-center text-xs text-text-tertiary">加载内容...</div>}>
                        <ArtifactViewer
                            artifact={viewing}
                            onBack={() => setViewing(null)}
                            onRegenerate={(type) => {
                                setViewing(null)
                                setRegenerating(type as 'audio' | 'mindmap' | 'report')
                            }}
                        />
                    </React.Suspense>
                </div>
                {regenerating && (
                    <React.Suspense fallback={null}>
                        <StudioActionModal
                            notebook={notebook}
                            type={regenerating}
                            open
                            onClose={() => setRegenerating(null)}
                            onGenerated={(a) => {
                                setRegenerating(null)
                                onArtifactsChange([a, ...artifacts.filter((x) => x.id !== a.id)])
                            }}
                        />
                    </React.Suspense>
                )}
            </div>
        )
    }

    return (
        <div className="max-h-48 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {artifacts.map((a) => (
                <div
                    key={a.id}
                    onClick={() => setViewing(a)}
                    className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-xl border border-border',
                        'hover:bg-fill-secondary/50 cursor-pointer transition-colors group text-xs',
                    )}
                >
                    <ArtifactIcon type={a.type} />
                    <span className="flex-1 truncate font-medium">{a.title}</span>
                    <span className="text-text-quaternary shrink-0">
                        {new Date(a.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                    </span>
                    <button
                        onClick={(e) => handleDelete(e, a.id)}
                        className="text-text-tertiary hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5"
                    >
                        <Trash2 size={11} />
                    </button>
                </div>
            ))}
        </div>
    )
}

const ArtifactIcon: React.FC<{ type: string }> = ({ type }) => {
    switch (type) {
        case 'mindmap': return <Brain size={12} className="text-purple-500 shrink-0" />
        case 'audio':   return <Volume2 size={12} className="text-green-500 shrink-0" />
        case 'report':  return <FileText size={12} className="text-blue-500 shrink-0" />
        default:        return <Sparkles size={12} className="text-amber-500 shrink-0" />
    }
}
