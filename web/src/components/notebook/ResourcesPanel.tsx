/**
 * ResourcesPanel — 笔记本资源浮层面板
 *
 * 从 NoteEditor 顶栏「资源」图标触发，右侧叠加显示。
 * 内容：内容生成（音频/导图/报告/概览）+ 已生成 Artifact 列表 + 笔记入口。
 * 完全复用 StudioActionModal / StudioOutputs / ArtifactViewer / NotesTab。
 */
import React from 'react'
import { X, Volume2, Brain, FileText, Sparkles, ChevronRight, StickyNote, ArrowLeft } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Artifact } from '../../types'
import { StudioActionModal } from './StudioActionModal'
import { StudioOutputs } from './studio/StudioOutputs'
import { ArtifactViewer } from './studio/ArtifactViewer'
import { NotesTab } from './studio/NotesTab'

type ModalAction = 'audio' | 'mindmap' | 'report' | null
type View = 'home' | 'artifact' | 'notes'

interface GenerateCard {
    id: 'audio' | 'mindmap' | 'report' | 'overview'
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    desc: string
    bg: string
    iconColor: string
}

const GENERATE_CARDS: GenerateCard[] = [
    { id: 'audio',   icon: Volume2,  label: '音频概览', desc: '生成对话式播客脚本', bg: 'bg-green-50 dark:bg-green-950/30',   iconColor: 'text-green-600 dark:text-green-400' },
    { id: 'mindmap', icon: Brain,    label: '思维导图', desc: '生成知识结构图',      bg: 'bg-purple-50 dark:bg-purple-950/30', iconColor: 'text-purple-600 dark:text-purple-400' },
    { id: 'report',  icon: FileText, label: '报告',     desc: '简报/学习指南/FAQ',   bg: 'bg-blue-50 dark:bg-blue-950/30',    iconColor: 'text-blue-600 dark:text-blue-400' },
    { id: 'overview',icon: Sparkles, label: '概览',     desc: '刷新笔记本摘要',      bg: 'bg-amber-50 dark:bg-amber-950/30',  iconColor: 'text-amber-600 dark:text-amber-400' },
]

interface Props {
    notebook: string
    onClose: () => void
}

export const ResourcesPanel: React.FC<Props> = ({ notebook, onClose }) => {
    const [view, setView] = React.useState<View>('home')
    const [modalAction, setModalAction] = React.useState<ModalAction>(null)
    const [viewingArtifact, setViewingArtifact] = React.useState<Artifact | null>(null)
    const [refreshKey, setRefreshKey] = React.useState(0)

    const handleCardClick = (card: GenerateCard) => {
        if (card.id === 'overview') {
            // overview triggers the overview modal type if available; for now treat as report
            setModalAction('report')
        } else {
            setModalAction(card.id as 'audio' | 'mindmap' | 'report')
        }
    }

    const handleGenerated = (artifact: Artifact) => {
        setRefreshKey((k) => k + 1)
        setViewingArtifact(artifact)
        setView('artifact')
    }

    if (view === 'artifact' && viewingArtifact) {
        return (
            <PanelShell onClose={onClose}>
                <ArtifactViewer
                    artifact={viewingArtifact}
                    onBack={() => { setViewingArtifact(null); setView('home') }}
                    onRegenerate={(type) => {
                        setViewingArtifact(null)
                        setView('home')
                        setModalAction(type)
                    }}
                />
                {modalAction && (
                    <StudioActionModal
                        notebook={notebook}
                        type={modalAction}
                        open={true}
                        onClose={() => setModalAction(null)}
                        onGenerated={handleGenerated}
                    />
                )}
            </PanelShell>
        )
    }

    if (view === 'notes') {
        return (
            <PanelShell onClose={onClose}>
                <div className="h-10 border-b border-border flex items-center gap-2 px-3 shrink-0">
                    <button
                        onClick={() => setView('home')}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary transition-colors"
                    >
                        <ArrowLeft size={13} />
                    </button>
                    <span className="text-xs font-semibold">笔记</span>
                </div>
                <div className="flex-1 overflow-hidden">
                    <NotesTab notebook={notebook} />
                </div>
            </PanelShell>
        )
    }

    return (
        <PanelShell onClose={onClose}>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* ── 内容生成 ─────────────────────────────────────────────── */}
                <div className="px-3 pt-3 pb-2">
                    <SectionLabel icon={<Sparkles size={10} />} label="内容生成" sub="基于所有来源" />
                    <div className="grid grid-cols-2 gap-2 mt-2">
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
                                    <ChevronRight size={11} className="text-text-quaternary group-hover:text-text-tertiary transition-colors" />
                                </div>
                                <div className="text-xs font-semibold text-text leading-tight">{card.label}</div>
                                <div className="text-[10px] text-text-tertiary mt-0.5 leading-tight line-clamp-1">{card.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mx-3 border-t border-border/60" />

                {/* ── 已生成 ────────────────────────────────────────────────── */}
                <div className="px-3 pt-2 pb-2">
                    <SectionLabel icon={<FileText size={10} />} label="已生成" />
                    <div className="mt-2">
                        <StudioOutputs
                            key={refreshKey}
                            notebook={notebook}
                            onViewArtifact={(a) => { setViewingArtifact(a); setView('artifact') }}
                        />
                    </div>
                </div>

                <div className="mx-3 border-t border-border/60" />

                {/* ── 笔记 ──────────────────────────────────────────────────── */}
                <div className="px-3 pt-2 pb-3">
                    <SectionLabel icon={<StickyNote size={10} />} label="笔记" />
                    <button
                        onClick={() => setView('notes')}
                        className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-text text-bg rounded-full text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                        <StickyNote size={12} /> 添加笔记
                    </button>
                </div>
            </div>

            {/* Generation modals — portal to body, no z-index conflict */}
            {modalAction && (
                <StudioActionModal
                    notebook={notebook}
                    type={modalAction}
                    open={true}
                    onClose={() => setModalAction(null)}
                    onGenerated={handleGenerated}
                />
            )}
        </PanelShell>
    )
}

// ── Shell ────────────────────────────────────────────────────────────────────

const PanelShell: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
    <div className="flex flex-col h-full bg-bg-container border-l border-border overflow-hidden">
        {/* Header */}
        <div className="h-10 flex items-center gap-2 px-3 border-b border-border/60 shrink-0">
            <Sparkles size={13} className="text-primary-mint shrink-0" />
            <span className="text-xs font-semibold text-text flex-1">资源</span>
            <button
                onClick={onClose}
                className="p-1 rounded-md text-text-quaternary hover:text-text-secondary hover:bg-fill transition-colors"
                title="关闭"
            >
                <X size={12} />
            </button>
        </div>
        {children}
    </div>
)

// ── Section label ────────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ icon: React.ReactNode; label: string; sub?: string }> = ({ icon, label, sub }) => (
    <div className="flex items-center gap-1.5">
        <span className="text-text-quaternary">{icon}</span>
        <span className="text-[11px] font-semibold text-text-secondary">{label}</span>
        {sub && <span className="text-[10px] text-text-quaternary">· {sub}</span>}
    </div>
)
