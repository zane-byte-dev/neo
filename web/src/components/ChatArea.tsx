import React from 'react'
import { Download, Loader2, BrainCircuit, ChevronRight } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import {
    fetchMessages,
} from '../api'
import { t } from '../i18n'
import type { ActivityItem, MessagePart } from '../types'
import { ChatActionsMenu } from './chat/ChatActionsMenu'
import { ToolApprovalsModal } from './chat/ToolApprovalsModal'
import { mergeMessageParts } from './chat/activity-utils'
import {
    messageMainText,
    CopyReplyButton,
    SpeakButton,
    isErrorMessage,
    ErrorMessageCard,
} from './chat/MessageActions'
import { ActivityBatchCard, ActivityFeed, ActivityItemCard } from './chat/ActivityCards'
import { ChatInput, type SlashCommand } from './chat/ChatInput'
import {
    CitedMD,
    FileAttachmentIcon,
    MD,
    MessageSkeleton,
    ScrollToBottom,
    TodoPanel,
    TypingIndicator,
    UserMessageBubble,
} from './chat/MessageParts'

// ── Chat area ─────────────────────────────────────────────────────────────────

export const ChatArea: React.FC<{
    slashCommands?: SlashCommand[]
    onSlashCommand?: (id: string) => void
}> = ({ slashCommands, onSlashCommand }) => {
    const { chats, activeChatId, messages, setMessages, setPendingQuickReply } = useAppStore()
    const isGenerating = useAppStore(s => activeChatId ? !!s.generatingBySession[activeChatId] : false)
    const thinkingStatus = useAppStore(s => activeChatId ? (s.thinkingStatusBySession[activeChatId] ?? '') : '')
    const activeChat = chats.find((c) => c.id === activeChatId)
    const chatMessages = React.useMemo(() => messages[activeChatId ?? ''] ?? [], [messages, activeChatId])
    const hasLoadedMessages = chatMessages.length > 0
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [showScrollBtn, setShowScrollBtn] = React.useState(false)
    const [showToolApprovals, setShowToolApprovals] = React.useState(false)

    // Load message history from server when session changes
    React.useEffect(() => {
        if (!activeChatId) return
        // Only load from server if we have no messages in memory yet
        if (hasLoadedMessages) return
        fetchMessages(activeChatId)
            .then((rows) => {
                if (rows.length > 0) {
                    setMessages(activeChatId, rows.map((r) => ({
                        id: r.id,
                        role: r.role as 'user' | 'assistant',
                        content: r.content,
                        activityLog: r.activityLog as ActivityItem[] | undefined,
                        parts: r.parts as MessagePart[] | undefined,
                        timestamp: r.timestamp,
                    })))
                }
            })
            .catch(() => { /* session may not exist yet */ })
    }, [activeChatId, hasLoadedMessages, setMessages])

    // Auto-scroll and track scroll position
    const scrollToBottom = React.useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [])

    React.useEffect(() => {
        if (chatMessages.length > 0) scrollToBottom()
    }, [chatMessages, scrollToBottom])

    const handleScroll = React.useCallback(() => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
        setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120)
    }, [])

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden relative min-w-0">
            {/* Header */}
            <div className="h-11 sm:h-14 flex items-center px-4 sm:px-6 pl-12 md:pl-6 shrink-0 bg-bg-container/80 backdrop-blur-xl relative">
                <span className="absolute left-0 right-0 text-center text-sm font-semibold truncate text-text tracking-tight px-16 pointer-events-none">
                    {activeChat?.title ?? t('welcome')}
                </span>
                {isGenerating && thinkingStatus && (
                    <span className="ml-3 text-xs text-text-tertiary flex items-center gap-1.5 shrink-0">
                        <Loader2 size={11} className="animate-spin text-primary-mint" />
                        <span className="hidden sm:inline">{thinkingStatus}</span>
                    </span>
                )}
                {activeChat && (
                    <ChatActionsMenu chat={activeChat} messages={chatMessages} />
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-4 py-3 sm:py-8">
                <div className="max-w-3xl mx-auto space-y-5 sm:space-y-7">
                    {chatMessages.length === 0 && <WelcomeScreen />}

                    {chatMessages.map((msg, msgIdx) => (
                        <div
                            key={msg.id}
                            className={cn(
                                'flex flex-col gap-1 w-full animate-slide-up',
                                msg.role === 'user' ? 'items-end' : 'items-start'
                            )}
                            style={{ animationDelay: `${Math.min(msgIdx * 30, 150)}ms` }}
                        >
                            {msg.role === 'user' ? (
                                <div className="max-w-[90%] sm:max-w-[80%]">
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                            {msg.images.map((src, i) => (
                                                <img key={i} src={src} alt="" className="max-h-40 rounded-xl border border-border" style={{ boxShadow: 'var(--shadow-soft)' }} />
                                            ))}
                                        </div>
                                    )}
                                    {msg.files && msg.files.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                            {msg.files.map((f, i) => (
                                                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs">
                                                    <FileAttachmentIcon filename={f.filename} />
                                                    <span className="text-text-secondary max-w-[150px] truncate">{f.filename}</span>
                                                    {f.pageCount && <span className="text-text-quaternary">({f.pageCount}p)</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {msg.content && (
                                        <UserMessageBubble content={msg.content} />
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <div className="mb-3">
                                            {/* Show first paragraph inline as a progress note; rest goes in a details */}
                                            {(() => {
                                                const lines = msg.thinking.trim().split('\n')
                                                const firstPara = lines[0]?.trim() ?? ''
                                                const rest = lines.slice(1).join('\n').trim()
                                                return (
                                                    <div className="text-xs text-text-secondary leading-relaxed">
                                                        <div className="flex items-start gap-1.5 mb-1">
                                                            <BrainCircuit size={12} className="shrink-0 mt-0.5 text-text-quaternary" />
                                                            <span className="flex-1">{firstPara}</span>
                                                        </div>
                                                        {rest && (
                                                            <details className="group ml-5">
                                                                <summary className="cursor-pointer text-[11px] text-text-quaternary hover:text-text-tertiary select-none list-none flex items-center gap-1 py-0.5">
                                                                    <ChevronRight size={10} className="transition-transform duration-200 group-open:rotate-90" />
                                                                    {t('thinkingLabel')}
                                                                </summary>
                                                                <div className="mt-1.5 pl-3 border-l-2 border-border/50 text-[11px] text-text-tertiary whitespace-pre-wrap">{rest}</div>
                                                            </details>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </div>
                                    )}
                                    {msg.todos && msg.todos.length > 0 && (
                                        <TodoPanel todos={msg.todos} />
                                    )}
                                    {msg.parts && msg.parts.length > 0 ? (
                                        <div>
                                            {mergeMessageParts(msg.parts).map((part, idx) => {
                                                if (part.type === 'text') return (
                                                    <div key={`${msg.id}-text-${idx}`} className="mb-3 last:mb-0">
                                                        {activeChat?.mode === 'notebook' ? (
                                                            <CitedMD content={part.content} sources={msg.citations} />
                                                        ) : (
                                                            <MD content={part.content} />
                                                        )}
                                                    </div>
                                                )
                                                if (part.type === 'activity-batch') return (
                                                    <ActivityBatchCard
                                                        key={`${msg.id}-batch-${idx}`}
                                                        items={part.items}
                                                        sessionId={activeChatId}
                                                    />
                                                )
                                                return (
                                                    <ActivityItemCard
                                                        key={`${msg.id}-activity-${part.item.confirmId ?? part.item.resultId ?? part.item.timestamp}-${part.resultItem?.resultId ?? 'none'}-${idx}`}
                                                        item={part.item}
                                                        resultItem={part.resultItem}
                                                        sessionId={activeChatId}
                                                    />
                                                )
                                            })}
                                            {isGenerating && !msg.parts.some((part) => part.type === 'text' && part.content.trim()) && (
                                                <TypingIndicator />
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            {msg.activityLog && msg.activityLog.length > 0 && (
                                                <ActivityFeed
                                                    items={msg.activityLog}
                                                    sessionId={activeChatId}
                                                />
                                            )}
                                            {!msg.content && isGenerating && (!msg.activityLog || msg.activityLog.length === 0) && (
                                                <TypingIndicator />
                                            )}
                                            {msg.content ? (
                                                isErrorMessage(msg.content) ? (
                                                    <ErrorMessageCard
                                                        message={msg.content}
                                                        onRetry={chatMessages[msgIdx - 1]?.role === 'user' && chatMessages[msgIdx - 1]?.content
                                                            ? () => setPendingQuickReply(chatMessages[msgIdx - 1].content)
                                                            : undefined}
                                                    />
                                                ) : activeChat?.mode === 'notebook' ? (
                                                    <CitedMD content={msg.content} sources={msg.citations} />
                                                ) : (
                                                    <MD content={msg.content} />
                                                )
                                            ) : isGenerating ? null : (
                                                <MessageSkeleton />
                                            )}
                                        </>
                                    )}
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {msg.images.map((src, i) => (
                                                <div key={i} className="relative group">
                                                    <img
                                                        src={src}
                                                        alt={t('generatedImage')}
                                                        className="max-w-sm rounded-2xl border border-border cursor-pointer hover:opacity-95 transition-opacity"
                                                        style={{ boxShadow: 'var(--shadow-soft)' }}
                                                        onClick={() => window.open(src, '_blank')}
                                                    />
                                                    <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <a
                                                            href={src}
                                                            download={`neo-image-${Date.now()}-${i}.png`}
                                                            className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                                                            title={t('download')}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <Download size={14} />
                                                        </a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {msg.videos && msg.videos.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {msg.videos.map((src, i) => (
                                                <video
                                                    key={i}
                                                    src={src}
                                                    controls
                                                    className="max-w-lg rounded-2xl border border-border"
                                                    style={{ boxShadow: 'var(--shadow-soft)' }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {(() => {
                                        const isLast = msgIdx === chatMessages.length - 1
                                        if (isGenerating && isLast) return null
                                        if (isErrorMessage(msg.content)) return null
                                        const actionText = messageMainText(msg)
                                        if (!actionText.trim()) return null
                                        return (
                                            <div className="mt-2 flex items-center gap-1">
                                                <CopyReplyButton text={actionText} />
                                                <SpeakButton text={actionText} />
                                            </div>
                                        )
                                    })()}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
            <ChatInput
                onOpenToolApprovals={() => setShowToolApprovals(true)}
                slashCommands={slashCommands}
                onSlashCommand={onSlashCommand}
            />
            <ToolApprovalsModal
                open={showToolApprovals}
                onClose={() => setShowToolApprovals(false)}
                currentSessionId={activeChatId}
            />
        </div>
    )
}
