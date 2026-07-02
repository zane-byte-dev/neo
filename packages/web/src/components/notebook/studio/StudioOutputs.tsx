import React from 'react'
import { Brain, Volume2, FileText, Sparkles, Trash2 } from 'lucide-react'
import { useAppStore } from '../../../stores/useAppStore'
import { notebookListArtifacts, notebookDeleteArtifact } from '../../../api'
import type { Artifact } from '../../../types'
import { confirm } from '../../ConfirmDialog'

export const StudioOutputs: React.FC<{ notebook: string; onViewArtifact: (a: Artifact) => void }> = ({ notebook, onViewArtifact }) => {
    const { notebookArtifacts, setNotebookArtifacts } = useAppStore()
    const [loading, setLoading] = React.useState(false)

    const load = React.useCallback(() => {
        setLoading(true)
        notebookListArtifacts(notebook).then(setNotebookArtifacts).finally(() => setLoading(false))
    }, [notebook, setNotebookArtifacts])

    React.useEffect(() => { load() }, [load])

    const remove = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (!(await confirm('删除此生成内容？', { destructive: true, confirmText: '删除' }))) return
        await notebookDeleteArtifact(notebook, id)
        load()
    }

    if (loading) {
        return <div className="text-xs text-text-tertiary text-center py-8">加载中…</div>
    }

    if (notebookArtifacts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-quaternary px-6">
                <Sparkles size={28} />
                <p className="text-sm font-medium text-primary-mint">Studio 输出将保存在此处。</p>
                <p className="text-xs text-center">添加来源后，点击即可添加音频概览、学习指南、思维导图等！</p>
            </div>
        )
    }

    return (
        <div className="p-3 space-y-2">
            {notebookArtifacts.map((a) => (
                <div
                    key={a.id}
                    onClick={() => onViewArtifact(a)}
                    className="border border-border rounded-xl p-3 hover:bg-fill-secondary/40 cursor-pointer transition-colors group"
                >
                    <div className="flex items-center gap-2">
                        <ArtifactIcon type={a.type} />
                        <span className="text-sm font-medium flex-1 truncate">{a.title}</span>
                        <button onClick={(e) => remove(e, a.id)} className="text-text-tertiary hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 size={11} />
                        </button>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">
                        {new Date(a.createdAt).toLocaleString('zh-CN')}
                        {a.subtype && ` · ${a.subtype}`}
                    </p>
                </div>
            ))}
        </div>
    )
}

const ArtifactIcon: React.FC<{ type: string }> = ({ type }) => {
    switch (type) {
        case 'mindmap': return <Brain size={13} className="text-purple-500 shrink-0" />
        case 'audio':   return <Volume2 size={13} className="text-green-500 shrink-0" />
        case 'report':  return <FileText size={13} className="text-blue-500 shrink-0" />
        default:        return <Sparkles size={13} className="text-amber-500 shrink-0" />
    }
}
