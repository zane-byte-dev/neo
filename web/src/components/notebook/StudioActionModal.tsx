/**
 * StudioActionModal — NotebookLM-style modal for configuring and generating artifacts.
 * Supports audio, mindmap, and report with relevant options.
 */
import React from 'react'
import { X, Volume2, Brain, FileText, Loader2, Check } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { notebookGenerateArtifact, GenerateArtifactPayload } from '../../api'
import type { Artifact } from '../../types'

type ActionType = 'audio' | 'mindmap' | 'report'

// ── Audio options ───────────────────────────────────────────────────────────
type AudioFormat = 'deep-dive' | 'summary' | 'review' | 'debate'
const AUDIO_FORMATS: { value: AudioFormat; label: string; desc: string }[] = [
    { value: 'deep-dive', label: '深入探究', desc: '两位主持人之间生动有趣的对话，旨在解读和关联来源中的主题' },
    { value: 'summary',   label: '摘要',     desc: '简短概要，旨在帮助您快速了解来源的核心思想' },
    { value: 'review',    label: '评论',     desc: '对来源的专家评价，旨在提供建设性反馈，帮助您改进内容' },
    { value: 'debate',    label: '辩论',     desc: '两位主持人之间思维缜密的辩论，旨在阐明对来源的不同观点' },
]

// ── Report options ──────────────────────────────────────────────────────────
const REPORT_TYPES: { value: string; label: string }[] = [
    { value: 'briefing',     label: '简报文档' },
    { value: 'study-guide',  label: '学习指南' },
    { value: 'faq',          label: 'FAQ' },
    { value: 'timeline',     label: '时间线' },
    { value: 'outline',      label: '大纲' },
]

interface Props {
    notebook: string
    type: ActionType
    open: boolean
    onClose: () => void
    onGenerated: (artifact: Artifact) => void
}

export const StudioActionModal: React.FC<Props> = ({ notebook, type, open, onClose, onGenerated }) => {
    const { selectedSourceIds, sources } = useAppStore()
    const [generating, setGenerating] = React.useState(false)
    const [error, setError] = React.useState('')

    // Audio state
    const [audioFormat, setAudioFormat] = React.useState<AudioFormat>('deep-dive')
    const [audioPrompt, setAudioPrompt] = React.useState('')

    // Mindmap state
    const [mindmapTopic, setMindmapTopic] = React.useState('')

    // Report state
    const [reportSubtype, setReportSubtype] = React.useState('briefing')
    const [reportCustom, setReportCustom] = React.useState('')

    const reset = () => {
        setError('')
        setGenerating(false)
        setAudioFormat('deep-dive')
        setAudioPrompt('')
        setMindmapTopic('')
        setReportSubtype('briefing')
        setReportCustom('')
    }

    const handleClose = () => {
        if (generating) return
        reset()
        onClose()
    }

    const handleGenerate = async () => {
        setGenerating(true)
        setError('')
        try {
            const payload: GenerateArtifactPayload = {
                notebook,
                type,
                sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
            }

            if (type === 'audio') {
                // Encode format preference into customPrompt
                const formatHints: Record<AudioFormat, string> = {
                    'deep-dive': '请以深入探究的风格，两位主持人进行生动有趣的对话，解读和关联来源中的主题。',
                    'summary': '请以简短摘要的风格，快速概括来源的核心思想。对话简洁明了。',
                    'review': '请以评论的风格，对来源进行专家评价，提供建设性反馈。',
                    'debate': '请以辩论的风格，两位主持人阐明对来源的不同观点，展开思维缜密的讨论。',
                }
                const hint = formatHints[audioFormat]
                const extra = audioPrompt.trim() ? `\n重点方向：${audioPrompt.trim()}` : ''
                payload.customPrompt = hint + extra
            }

            if (type === 'mindmap') {
                if (mindmapTopic.trim()) payload.topic = mindmapTopic.trim()
            }

            if (type === 'report') {
                payload.subtype = reportSubtype === 'custom' ? 'custom' : reportSubtype
                if (reportSubtype === 'custom' && reportCustom.trim()) {
                    payload.customPrompt = reportCustom.trim()
                }
            }

            const artifact = await notebookGenerateArtifact(payload)
            onGenerated(artifact)
            handleClose()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setGenerating(false)
        }
    }

    if (!open) return null

    const title = type === 'audio' ? '自定义音频概览' : type === 'mindmap' ? '自定义思维导图' : '自定义报告'
    const Icon = type === 'audio' ? Volume2 : type === 'mindmap' ? Brain : FileText
    const iconColor = type === 'audio' ? 'text-green-600' : type === 'mindmap' ? 'text-purple-600' : 'text-blue-600'
    const canGenerate = sources.length > 0 && !generating &&
        (type !== 'report' || reportSubtype !== 'custom' || reportCustom.trim().length > 0)

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 animate-fade-in" onClick={handleClose}>
            <div
                className="bg-bg-container rounded-2xl shadow-2xl w-[560px] max-w-[92vw] max-h-[85vh] overflow-y-auto animate-slide-up"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-2 px-5 pt-5 pb-4">
                    <Icon size={18} className={iconColor} />
                    <h2 className="text-base font-semibold text-text flex-1">{title}</h2>
                    <button onClick={handleClose} className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 pb-5 space-y-5">
                    {/* ── Audio options ── */}
                    {type === 'audio' && (
                        <>
                            <div>
                                <h3 className="text-sm font-medium text-text mb-3">格式</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {AUDIO_FORMATS.map((f) => (
                                        <button
                                            key={f.value}
                                            onClick={() => setAudioFormat(f.value)}
                                            className={`text-left p-3 rounded-xl border-2 transition-colors ${
                                                audioFormat === f.value
                                                    ? 'border-primary-mint bg-primary-mint/5'
                                                    : 'border-border hover:border-primary-mint/30'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-sm font-medium">{f.label}</span>
                                                {audioFormat === f.value && <Check size={14} className="text-primary-mint" />}
                                            </div>
                                            <p className="text-xs text-text-tertiary leading-relaxed">{f.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-medium text-text mb-2">AI 主持人在本集节目中应着重于哪些方面?</h3>
                                <textarea
                                    value={audioPrompt}
                                    onChange={(e) => setAudioPrompt(e.target.value)}
                                    placeholder="例如：重点讨论 AI Agent 的实际应用场景和开发者体验..."
                                    rows={3}
                                    className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none"
                                />
                            </div>
                        </>
                    )}

                    {/* ── Mindmap options ── */}
                    {type === 'mindmap' && (
                        <div>
                            <h3 className="text-sm font-medium text-text mb-2">主题（可选）</h3>
                            <input
                                value={mindmapTopic}
                                onChange={(e) => setMindmapTopic(e.target.value)}
                                placeholder="留空则自动从来源中提取主题"
                                className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                            />
                            <p className="text-xs text-text-tertiary mt-2">思维导图将基于已选来源生成层级结构</p>
                        </div>
                    )}

                    {/* ── Report options ── */}
                    {type === 'report' && (
                        <>
                            <div>
                                <h3 className="text-sm font-medium text-text mb-3">报告类型</h3>
                                <div className="flex flex-wrap gap-2">
                                    {REPORT_TYPES.map((r) => (
                                        <button
                                            key={r.value}
                                            onClick={() => setReportSubtype(r.value)}
                                            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border-2 transition-colors ${
                                                reportSubtype === r.value
                                                    ? 'border-primary-mint bg-primary-mint/5 text-primary-mint'
                                                    : 'border-border hover:border-primary-mint/30 text-text-secondary'
                                            }`}
                                        >
                                            {reportSubtype === r.value && <Check size={12} />}
                                            {r.label}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setReportSubtype('custom')}
                                        className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border-2 transition-colors ${
                                            reportSubtype === 'custom'
                                                ? 'border-primary-mint bg-primary-mint/5 text-primary-mint'
                                                : 'border-border hover:border-primary-mint/30 text-text-secondary'
                                        }`}
                                    >
                                        {reportSubtype === 'custom' && <Check size={12} />}
                                        自定义
                                    </button>
                                </div>
                            </div>
                            {reportSubtype === 'custom' && (
                                <div>
                                    <h3 className="text-sm font-medium text-text mb-2">描述你想要的报告</h3>
                                    <textarea
                                        value={reportCustom}
                                        onChange={(e) => setReportCustom(e.target.value)}
                                        placeholder="例如：基于来源内容，生成一份技术方案对比分析..."
                                        rows={3}
                                        className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none"
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {/* Source count hint */}
                    <p className="text-xs text-text-tertiary">
                        将基于 {selectedSourceIds.length || sources.length} 个来源生成
                    </p>

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    {/* Generate button */}
                    <div className="flex justify-end">
                        <button
                            onClick={handleGenerate}
                            disabled={!canGenerate}
                            className="flex items-center gap-2 px-5 py-2.5 bg-primary-mint text-white text-sm font-medium rounded-xl hover:bg-primary-mint/90 disabled:opacity-50 transition-colors"
                        >
                            {generating ? <Loader2 size={14} className="animate-spin" /> : null}
                            {generating ? '生成中…' : '生成'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
