/**
 * NotebookWorkspace — NotebookLM-style 3-column workspace
 * on mobile, switches between tabs.
 */
import React from 'react'
import { ArrowLeft, FileText, MessageSquare, Sparkles, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Link as LinkIcon, Youtube, Type, Volume2, Brain, StickyNote } from 'lucide-react'
import { SourcePanel } from './SourcePanel'
import { StudioPanel } from './StudioPanel'
import { SourceDetailView } from './SourceDetailView'
import { ChatArea } from '../ChatArea'
import { useAppStore } from '../../stores/useAppStore'
import { cn } from '../../lib/utils'
import type { ParsedCitation, SourceMeta } from '../../types'

const MOBILE_BREAKPOINT = 1024  // lg

// Source type to icon mapping (mirrors SourceRow)
const SOURCE_TYPE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    url: LinkIcon,
    youtube: Youtube,
    pdf: FileText,
    text: Type,
    audio: Volume2,
    image: FileText,
}

// Studio cards for collapsed strip
const STUDIO_CARDS = [
    { id: 'audio',    icon: Volume2,    label: '音频概览', iconColor: 'text-green-600 dark:text-green-400',  bg: 'hover:bg-green-50 dark:hover:bg-green-950/30' },
    { id: 'mindmap',  icon: Brain,      label: '思维导图', iconColor: 'text-purple-600 dark:text-purple-400', bg: 'hover:bg-purple-50 dark:hover:bg-purple-950/30' },
    { id: 'report',   icon: FileText,   label: '报告',     iconColor: 'text-blue-600 dark:text-blue-400',    bg: 'hover:bg-blue-50 dark:hover:bg-blue-950/30' },
    { id: 'overview', icon: Sparkles,   label: '概览',     iconColor: 'text-amber-600 dark:text-amber-400',  bg: 'hover:bg-amber-50 dark:hover:bg-amber-950/30' },
    { id: 'notes',    icon: StickyNote, label: '笔记',     iconColor: 'text-rose-600 dark:text-rose-400',    bg: 'hover:bg-rose-50 dark:hover:bg-rose-950/30' },
]

interface Props {
    notebook: string
    onBack: () => void
}

type MobileTab = 'sources' | 'chat' | 'studio'

export const NotebookWorkspace: React.FC<Props> = ({ notebook, onBack }) => {
    const [isMobile, setIsMobile] = React.useState(false)
    const [mobileTab, setMobileTab] = React.useState<MobileTab>('chat')
    const [viewingSource, setViewingSource] = React.useState<SourceMeta | null>(null)
    const [citationTarget, setCitationTarget] = React.useState<ParsedCitation | null>(null)
    const [sourceCollapsed, setSourceCollapsed] = React.useState(false)
    const [studioCollapsed, setStudioCollapsed] = React.useState(false)
    // Only animate when collapsing (shrinking), not when expanding (avoids text reflow jitter)
    const [sourceAnimating, setSourceAnimating] = React.useState(false)
    const [studioAnimating, setStudioAnimating] = React.useState(false)
    // Resizable panel widths (px)
    const [sourceWidth, setSourceWidth] = React.useState(288)   // 18rem ≈ w-72
    const [studioWidth, setStudioWidth] = React.useState(320)   // 20rem ≈ w-80
    const dragRef = React.useRef<{ handle: 'source' | 'studio'; startX: number; startWidth: number } | null>(null)
    const { selectedModel, setSelectedModel, sources, selectedSourceIds, openOrCreateNotebookChat, setChatSourceIds, activeChatId } = useAppStore()

    // Bind notebook to a chat session on mount / notebook change
    React.useEffect(() => {
        let cancelled = false
        openOrCreateNotebookChat(notebook).catch((err) => {
            if (!cancelled) console.error('[notebook] failed to open chat session', err)
        })
        return () => { cancelled = true }
    }, [notebook, openOrCreateNotebookChat])

    // Sync source selection to the bound chat session
    React.useEffect(() => {
        if (!activeChatId) return
        // Only sync when the active chat is the notebook's session
        const chat = useAppStore.getState().chats.find((c) => c.id === activeChatId)
        if (!chat || chat.mode !== 'notebook' || chat.notebookId !== notebook) return
        const current = chat.sourceIds ?? []
        const next = selectedSourceIds
        if (current.length === next.length && current.every((v, i) => v === next[i])) return
        setChatSourceIds(activeChatId, next).catch((err) => console.error('[notebook] sync sources failed', err))
    }, [selectedSourceIds, activeChatId, notebook, setChatSourceIds])

    const collapseSource = React.useCallback(() => {
        setSourceAnimating(true)
        setSourceCollapsed(true)
        setTimeout(() => setSourceAnimating(false), 300)
    }, [])
    const expandSource = React.useCallback(() => {
        setSourceCollapsed(false)
    }, [])
    const collapseStudio = React.useCallback(() => {
        setStudioAnimating(true)
        setStudioCollapsed(true)
        setTimeout(() => setStudioAnimating(false), 300)
    }, [])
    const expandStudio = React.useCallback(() => {
        setStudioCollapsed(false)
    }, [])

    // Global mouse handlers for panel drag-resize
    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const drag = dragRef.current
            if (!drag) return
            const delta = e.clientX - drag.startX
            if (drag.handle === 'source') {
                setSourceWidth(Math.max(180, Math.min(600, drag.startWidth + delta)))
            } else {
                setStudioWidth(Math.max(180, Math.min(600, drag.startWidth - delta)))
            }
        }
        const onUp = () => { dragRef.current = null; document.body.style.cursor = '' }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [])

    const startDrag = React.useCallback((handle: 'source' | 'studio', e: React.MouseEvent) => {
        e.preventDefault()
        dragRef.current = {
            handle,
            startX: e.clientX,
            startWidth: handle === 'source' ? sourceWidth : studioWidth,
        }
        document.body.style.cursor = 'col-resize'
    }, [sourceWidth, studioWidth])

    React.useEffect(() => {
        const handle = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
        handle()
        window.addEventListener('resize', handle)
        return () => window.removeEventListener('resize', handle)
    }, [])

    // Citation click handler — navigate to SourceDetailView (in source panel).
    // TODO: wire up via store/event so ChatArea's CitationRenderer can trigger it.
    // For now, citation buttons are still clickable but no panel navigation.
    void sources

    if (isMobile) {
        return (
            <div className="flex flex-col h-full bg-bg overflow-hidden">
                <div className="h-12 border-b border-border flex items-center gap-2 px-3 shrink-0">
                    <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg">
                        <ArrowLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold flex-1 truncate">{notebook}</span>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}
                        className="px-2 py-1 rounded-lg text-[11px] font-medium bg-transparent text-text-tertiary border border-transparent hover:border-fill hover:bg-fill focus:outline-none focus:border-primary-mint/30 focus:text-primary-mint transition-all duration-200 cursor-pointer shrink-0"
                    >
                        <option value="auto">🧠 Auto</option>
                        <option value="flash">⚡ Flash</option>
                        <option value="pro">✨ Pro</option>
                        <option value="deepseek">🐋 DeepSeek</option>
                        <option value="gemma">🦙 Gemma</option>
                        <option value="gemini-acp">💎 Gemini</option>
                    </select>
                </div>
                <div className="flex-1 overflow-hidden">
                    {mobileTab === 'sources' && (viewingSource
                        ? <SourceDetailView notebook={notebook} source={viewingSource} focusCitation={citationTarget?.sourceId === viewingSource.id ? citationTarget : null} onBack={() => { setViewingSource(null); setCitationTarget(null) }} />
                        : <SourcePanel notebook={notebook} onSelectSource={(s) => { setViewingSource(s); setCitationTarget(null) }} />
                    )}
                    {mobileTab === 'chat' && <ChatArea />}
                    {mobileTab === 'studio'  && <StudioPanel notebook={notebook} />}
                </div>
                <div className="h-14 border-t border-border flex items-center shrink-0 bg-bg-container">
                    {([
                        ['sources', FileText, '来源'],
                        ['chat',    MessageSquare, '对话'],
                        ['studio',  Sparkles, '工作室'],
                    ] as const).map(([k, Icon, label]) => (
                        <button
                            key={k}
                            onClick={() => setMobileTab(k)}
                            className={cn(
                                'flex-1 flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] transition-colors',
                                mobileTab === k ? 'text-primary-mint' : 'text-text-tertiary',
                            )}
                        >
                            <Icon size={16} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        )
    }

    // Desktop: 3-card layout with collapsible source & studio panels
    return (
        <div className="flex h-full bg-bg-layout p-2 overflow-hidden select-none">
            {/* Source card */}
            <div
                className={cn(
                    'flex flex-col bg-bg-container rounded-2xl border border-border shrink-0 overflow-hidden',
                    sourceAnimating && 'transition-all duration-300',
                )}
                style={{ width: sourceCollapsed ? 52 : sourceWidth }}
            >
                {sourceCollapsed ? (
                    /* Collapsed source: icon per source item */
                    <div className="flex flex-col items-center h-full">
                        {/* Toggle + Add */}
                        <div className="flex flex-col items-center pt-2 pb-1 gap-0.5 shrink-0">
                            <button
                                onClick={expandSource}
                                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-fill text-text-tertiary hover:text-primary-mint transition-colors"
                                title="展开来源"
                            >
                                <PanelLeftOpen size={15} />
                            </button>
                            <button
                                onClick={expandSource}
                                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-fill text-text-tertiary hover:text-primary-mint transition-colors"
                                title="添加来源"
                            >
                                <Plus size={15} />
                            </button>
                        </div>
                        <div className="w-6 h-px bg-border shrink-0" />
                        {/* Source icons list */}
                        <div className="flex-1 overflow-y-auto py-1.5 flex flex-col items-center gap-0.5 custom-scrollbar w-full">
                            {sources.map((s) => {
                                const Icon = SOURCE_TYPE_ICON[s.type] ?? FileText
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => { setViewingSource(s); expandSource() }}
                                        className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-fill text-text-tertiary hover:text-text-secondary transition-colors shrink-0"
                                        title={s.title}
                                    >
                                        <Icon size={14} />
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Card header with collapse button */}
                        <div className="h-11 border-b border-border flex items-center gap-2 px-3 shrink-0">
                            {viewingSource ? (
                                <>
                                    <button
                                        onClick={() => { setViewingSource(null); setCitationTarget(null) }}
                                        className="p-1 hover:bg-fill rounded-lg text-text-secondary transition-colors"
                                        title="返回来源列表"
                                    >
                                        <ArrowLeft size={14} />
                                    </button>
                                    <span className="text-sm font-semibold flex-1 truncate text-text">{viewingSource.title}</span>
                                </>
                            ) : (
                                <>
                                    <FileText size={14} className="text-primary-mint" />
                                    <span className="text-sm font-semibold flex-1">来源</span>
                                    <button
                                        onClick={collapseSource}
                                        className="p-1.5 rounded-lg hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors"
                                        title="收起来源"
                                    >
                                        <PanelLeftClose size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {viewingSource
                                ? <SourceDetailView notebook={notebook} source={viewingSource} focusCitation={citationTarget?.sourceId === viewingSource.id ? citationTarget : null} onBack={() => { setViewingSource(null); setCitationTarget(null) }} />
                                : <SourcePanel notebook={notebook} onSelectSource={(source) => { setViewingSource(source); setCitationTarget(null) }} hideHeader />
                            }
                        </div>
                    </>
                )}
            </div>

            {/* Drag handle: source | chat */}
            {!sourceCollapsed && (
                <div
                    onMouseDown={(e) => startDrag('source', e)}
                    className="w-2 mx-0.5 shrink-0 cursor-col-resize flex items-center justify-center group self-stretch"
                    title="拖动调整宽度"
                >
                    <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary-mint/50 transition-colors" />
                </div>
            )}
            {sourceCollapsed && <div className="w-2 shrink-0" />}

            {/* Chat card */}
            <div className="flex-1 min-w-0 flex flex-col bg-bg-container rounded-2xl border border-border overflow-hidden">
                {/* Chat header */}
                <div className="h-11 border-b border-border flex items-center gap-2 px-3 shrink-0">
                    <button onClick={onBack} className="p-1 hover:bg-fill rounded-lg text-text-secondary transition-colors" title="返回">
                        <ArrowLeft size={15} />
                    </button>
                    <span className="text-sm font-semibold flex-1 truncate text-text">{notebook}</span>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}
                        className="px-2 py-1 rounded-lg text-[11px] font-medium bg-transparent text-text-tertiary border border-transparent hover:border-fill hover:bg-fill focus:outline-none focus:border-primary-mint/30 focus:text-primary-mint transition-all duration-200 cursor-pointer shrink-0"
                    >
                        <option value="auto">🧠 Auto</option>
                        <option value="flash">⚡ Flash</option>
                        <option value="pro">✨ Pro</option>
                        <option value="deepseek">🐋 DeepSeek</option>
                        <option value="gemma">🦙 Gemma</option>
                        <option value="gemini-acp">💎 Gemini</option>
                    </select>
                </div>
                <div className="flex-1 overflow-hidden">
                    <ChatArea />
                </div>
            </div>

            {/* Drag handle: chat | studio */}
            {!studioCollapsed && (
                <div
                    onMouseDown={(e) => startDrag('studio', e)}
                    className="w-2 mx-0.5 shrink-0 cursor-col-resize flex items-center justify-center group self-stretch"
                    title="拖动调整宽度"
                >
                    <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary-mint/50 transition-colors" />
                </div>
            )}
            {studioCollapsed && <div className="w-2 shrink-0" />}

            {/* Studio card */}
            <div
                className={cn(
                    'flex flex-col bg-bg-container rounded-2xl border border-border shrink-0 overflow-hidden',
                    studioAnimating && 'transition-all duration-300',
                )}
                style={{ width: studioCollapsed ? 52 : studioWidth }}
            >
                {studioCollapsed ? (
                    /* Collapsed studio: icon per studio card */
                    <div className="flex flex-col items-center h-full">
                        <div className="flex flex-col items-center pt-2 pb-1 shrink-0">
                            <button
                                onClick={expandStudio}
                                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-fill text-text-tertiary hover:text-primary-mint transition-colors"
                                title="展开 Studio"
                            >
                                <PanelRightOpen size={15} />
                            </button>
                        </div>
                        <div className="w-6 h-px bg-border shrink-0" />
                        {/* Studio card icons */}
                        <div className="flex-1 py-1.5 flex flex-col items-center gap-0.5 w-full">
                            {STUDIO_CARDS.map((card) => (
                                <button
                                    key={card.id}
                                    onClick={expandStudio}
                                    className={cn(
                                        'w-9 h-9 flex items-center justify-center rounded-xl transition-colors shrink-0',
                                        card.iconColor,
                                        card.bg
                                    )}
                                    title={card.label}
                                >
                                    <card.icon size={15} />
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Card header with collapse button */}
                        <div className="h-11 border-b border-border flex items-center gap-2 px-3 shrink-0">
                            <Sparkles size={14} className="text-primary-mint" />
                            <span className="text-sm font-semibold flex-1">Studio</span>
                            <button
                                onClick={collapseStudio}
                                className="p-1.5 rounded-lg hover:bg-fill text-text-quaternary hover:text-text-secondary transition-colors"
                                title="收起 Studio"
                            >
                                <PanelRightClose size={14} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <StudioPanel notebook={notebook} hideHeader />
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
