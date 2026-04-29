/**
 * StudioPanel — right column: NotebookLM-style card grid + modal actions.
 * Cards open modals for generating artifacts; overview & notes stay as sub-views.
 */
import React from 'react'
import { StickyNote, Volume2, Brain, FileText, Sparkles, ChevronRight, ArrowLeft } from 'lucide-react'
import type { Artifact } from '../../types'
import { StudioActionModal } from './StudioActionModal'
import { OverviewTab } from './studio/OverviewTab'
import { NotesTab } from './studio/NotesTab'
import { StudioOutputs } from './studio/StudioOutputs'
import { ArtifactViewer } from './studio/ArtifactViewer'

type View = 'home' | 'overview' | 'notes' | 'artifact-view'
type ModalAction = 'audio' | 'mindmap' | 'report' | null

interface Props { notebook: string; hideHeader?: boolean }

// Card definitions for the grid
interface StudioCard {
    id: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    label: string
    bg: string
    iconColor: string
    action: 'modal' | 'view'  // modal = open StudioActionModal; view = navigate to sub-view
    modalType?: 'audio' | 'mindmap' | 'report'
    viewId?: View
}

const CARDS: StudioCard[] = [
    { id: 'audio',   icon: Volume2,   label: '音频概览', bg: 'bg-green-50 dark:bg-green-950/30',   iconColor: 'text-green-600 dark:text-green-400',  action: 'modal', modalType: 'audio' },
    { id: 'mindmap', icon: Brain,     label: '思维导图', bg: 'bg-purple-50 dark:bg-purple-950/30',  iconColor: 'text-purple-600 dark:text-purple-400', action: 'modal', modalType: 'mindmap' },
    { id: 'report',  icon: FileText,  label: '报告',     bg: 'bg-blue-50 dark:bg-blue-950/30',     iconColor: 'text-blue-600 dark:text-blue-400',    action: 'modal', modalType: 'report' },
    { id: 'overview', icon: Sparkles, label: '概览',     bg: 'bg-amber-50 dark:bg-amber-950/30',   iconColor: 'text-amber-600 dark:text-amber-400',  action: 'view',  viewId: 'overview' },
    { id: 'notes',   icon: StickyNote, label: '笔记',    bg: 'bg-rose-50 dark:bg-rose-950/30',     iconColor: 'text-rose-600 dark:text-rose-400',    action: 'view',  viewId: 'notes' },
]

export const StudioPanel: React.FC<Props> = ({ notebook, hideHeader }) => {
    const [view, setView] = React.useState<View>('home')
    const [modalAction, setModalAction] = React.useState<ModalAction>(null)
    const [viewingArtifact, setViewingArtifact] = React.useState<Artifact | null>(null)
    const [refreshKey, setRefreshKey] = React.useState(0)

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
        <div className="flex flex-col h-full bg-bg-container">
            {!hideHeader && (
                <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0">
                    <Sparkles size={15} className="text-primary-mint" />
                    <span className="text-sm font-semibold">Studio</span>
                </div>
            )}

            {/* Card grid */}
            <div className="p-3 grid grid-cols-2 gap-2 shrink-0">
                {CARDS.map((card) => (
                    <button
                        key={card.id}
                        onClick={() => handleCardClick(card)}
                        className={`${card.bg} rounded-xl p-3 text-left hover:opacity-80 transition-opacity group`}
                    >
                        <div className="flex items-center justify-between mb-1.5">
                            <card.icon size={16} className={card.iconColor} />
                            <ChevronRight size={14} className="text-text-quaternary group-hover:text-text-tertiary transition-colors" />
                        </div>
                        <span className="text-xs font-medium text-text">{card.label}</span>
                    </button>
                ))}
            </div>

            {/* Generated outputs area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <StudioOutputs key={refreshKey} notebook={notebook} onViewArtifact={openArtifact} />
            </div>

            {/* Add note button */}
            <div className="p-3 shrink-0">
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

