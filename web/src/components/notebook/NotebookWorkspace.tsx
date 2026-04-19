/**
 * NotebookWorkspace — NotebookLM-style 3-column workspace
 * on mobile, switches between tabs.
 */
import React from 'react'
import { ArrowLeft, FileText, MessageSquare, Sparkles } from 'lucide-react'
import { SourcePanel } from './SourcePanel'
import { NotebookChat } from './NotebookChat'
import { StudioPanel } from './StudioPanel'
import { cn } from '../../lib/utils'

const MOBILE_BREAKPOINT = 1024  // lg

interface Props {
    notebook: string
    onBack: () => void
}

type MobileTab = 'sources' | 'chat' | 'studio'

export const NotebookWorkspace: React.FC<Props> = ({ notebook, onBack }) => {
    const [isMobile, setIsMobile] = React.useState(false)
    const [mobileTab, setMobileTab] = React.useState<MobileTab>('chat')

    React.useEffect(() => {
        const handle = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
        handle()
        window.addEventListener('resize', handle)
        return () => window.removeEventListener('resize', handle)
    }, [])

    if (isMobile) {
        return (
            <div className="flex flex-col h-full bg-bg overflow-hidden">
                <div className="h-12 border-b border-border flex items-center gap-2 px-3 shrink-0">
                    <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg">
                        <ArrowLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold flex-1 truncate">{notebook}</span>
                </div>
                <div className="flex-1 overflow-hidden">
                    {mobileTab === 'sources' && <SourcePanel notebook={notebook} />}
                    {mobileTab === 'chat'    && <NotebookChat notebook={notebook} />}
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

    return (
        <div className="flex h-full bg-bg overflow-hidden">
            <div className="w-72 shrink-0">
                <SourcePanel notebook={notebook} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="h-12 border-b border-border flex items-center gap-2 px-3 shrink-0 bg-bg-container">
                    <button onClick={onBack} className="p-1.5 hover:bg-fill-secondary rounded-lg" title="返回">
                        <ArrowLeft size={15} />
                    </button>
                    <span className="text-sm font-semibold flex-1 truncate">{notebook}</span>
                </div>
                <div className="flex-1 overflow-hidden">
                    <NotebookChat notebook={notebook} />
                </div>
            </div>
            <div className="w-96 shrink-0">
                <StudioPanel notebook={notebook} />
            </div>
        </div>
    )
}
