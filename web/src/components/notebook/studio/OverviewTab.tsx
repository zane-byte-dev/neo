import React from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../../stores/useAppStore'
import { notebookGenerateOverview, notebookGetConfig } from '../../../api'
import { toast } from '../../Toast'

interface Props { notebook: string }

export const OverviewTab: React.FC<Props> = ({ notebook }) => {
    const { notebookConfig, setNotebookConfig, selectedSourceIds, sources } = useAppStore()
    const [loading, setLoading] = React.useState(false)
    const [generating, setGenerating] = React.useState(false)

    React.useEffect(() => {
        setLoading(true)
        notebookGetConfig(notebook).then(setNotebookConfig).catch(() => setNotebookConfig(null)).finally(() => setLoading(false))
    }, [notebook, setNotebookConfig])

    const regenerate = async () => {
        setGenerating(true)
        try {
            const { overview } = await notebookGenerateOverview(notebook, selectedSourceIds.length ? selectedSourceIds : undefined)
            setNotebookConfig({ ...notebookConfig, overview, overviewUpdatedAt: new Date().toISOString() })
        } catch (e) {
            toast.error(`生成失败：${(e as Error).message}`)
        } finally { setGenerating(false) }
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold">笔记本概览</h3>
                <button
                    onClick={regenerate}
                    disabled={generating || sources.length === 0}
                    className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary-mint/10 text-primary-mint hover:bg-primary-mint/20 rounded-lg disabled:opacity-50"
                >
                    {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    {notebookConfig?.overview ? '重新生成' : '生成'}
                </button>
            </div>
            {loading ? (
                <div className="space-y-2">
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-5/6" />
                    <div className="skeleton h-4 w-4/6" />
                </div>
            ) : notebookConfig?.overview ? (
                <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{notebookConfig.overview}</ReactMarkdown>
                    {notebookConfig.overviewUpdatedAt && (
                        <p className="text-xs text-text-tertiary mt-4">
                            更新于 {new Date(notebookConfig.overviewUpdatedAt).toLocaleString('zh-CN')}
                        </p>
                    )}
                </div>
            ) : (
                <div className="text-center text-text-quaternary text-sm py-8">
                    <Sparkles size={24} className="mx-auto mb-2 text-text-quaternary" />
                    <p>点击上方 "生成" 按钮创建概览</p>
                </div>
            )}
        </div>
    )
}
