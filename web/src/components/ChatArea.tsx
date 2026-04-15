import React from 'react'
import { Send, Square, CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import { streamChat, fetchMessages } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ActivityItem, AgentTodoItem } from '../types'
import { CodeBlock, InlineCode } from './CodeBlock'

// ── Markdown renderer ─────────────────────────────────────────────────────────

const markdownComponents: import('react-markdown').Components = {
    pre({ children }) {
        return <>{children}</>
    },
    code({ className, children, ...rest }) {
        const match = /language-(\w+)/.exec(className || '')
        const text = String(children).replace(/\n$/, '')

        // Block code (inside pre) — detect by the presence of language class or multiline content
        if (match || text.includes('\n')) {
            return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
        }

        // Inline code
        return <InlineCode {...rest}>{children}</InlineCode>
    },
}

const MD: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
        >
            {content}
        </ReactMarkdown>
    </div>
)

// ── Skeleton loading ──────────────────────────────────────────────────────────

const MessageSkeleton: React.FC = () => (
    <div className="space-y-3 animate-fade-in">
        <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2.5">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-4 w-5/6" />
            </div>
        </div>
    </div>
)

// ── Typing indicator ──────────────────────────────────────────────────────────

const TypingIndicator: React.FC = () => (
    <div className="mb-3 rounded-2xl border border-border bg-fill-secondary/60 p-4 backdrop-blur-sm"
         style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
            </div>
            <span className="text-xs text-text-tertiary ml-1">Thinking…</span>
        </div>
    </div>
)

// ── Activity panel (live tool call log) ───────────────────────────────────────

const ActivityPanel: React.FC<{ items: ActivityItem[]; isLive?: boolean }> = ({ items, isLive }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
        if (isLive && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [items.length, isLive])

    const callCount = items.filter(i => i.type === 'tool_call').length
    const summary = callCount === 1 ? '1 tool call' : `${callCount} tool calls`

    const content = (
        <div
            ref={scrollRef}
            className={cn(
                'space-y-1 font-mono text-xs leading-relaxed overflow-y-auto custom-scrollbar',
                isLive ? 'max-h-44' : 'max-h-52 mt-2'
            )}
        >
            {items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 min-w-0 animate-activity-in py-0.5">
                    {item.type === 'tool_call' ? (
                        <>
                            <Wrench size={11} className="text-primary-mint shrink-0 mt-0.5" />
                            <span className="text-text-secondary shrink-0 font-medium">{item.toolName}</span>
                            {item.args && (
                                <span className="text-text-tertiary truncate">
                                    {JSON.stringify(item.args)}
                                </span>
                            )}
                        </>
                    ) : (
                        <>
                            <span className="text-success shrink-0 mt-0.5 text-[10px]">✓</span>
                            <span className="text-text-tertiary shrink-0">{item.toolName}</span>
                            {item.result && (
                                <span className="text-text-tertiary/60 truncate">
                                    → {item.result}
                                </span>
                            )}
                        </>
                    )}
                </div>
            ))}
            {isLive && (
                <div className="flex items-center gap-1.5 py-1">
                    <span className="typing-dot" style={{ width: 4, height: 4 }} />
                    <span className="typing-dot" style={{ width: 4, height: 4 }} />
                    <span className="typing-dot" style={{ width: 4, height: 4 }} />
                </div>
            )}
        </div>
    )

    if (isLive) {
        return (
            <div className="mb-3 rounded-2xl border border-border bg-fill-secondary/60 p-4 backdrop-blur-sm"
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mb-2">
                    <Loader2 size={12} className="animate-spin text-primary-mint" />
                    <span className="font-medium">Working…</span>
                </div>
                {content}
            </div>
        )
    }

    return (
        <details className="mb-3 group">
            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5 py-1">
                <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
                <Wrench size={11} className="text-text-tertiary" />
                <span>{summary}</span>
            </summary>
            <div className="mt-1 pl-4 border-l-2 border-border/60">
                {content}
            </div>
        </details>
    )
}

// ── Todo panel (inline progress tracker) ──────────────────────────────────────

const TodoIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'completed':
            return <CheckCircle2 size={14} className="text-success shrink-0" />
        case 'in-progress':
            return <Loader2 size={14} className="text-primary-mint shrink-0 animate-spin" />
        default:
            return <Circle size={14} className="text-text-quaternary shrink-0" />
    }
}

const TodoPanel: React.FC<{ todos: AgentTodoItem[] }> = ({ todos }) => {
    const completed = todos.filter(t => t.status === 'completed').length
    const total = todos.length
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0

    return (
        <div className="my-3 rounded-2xl border border-border bg-fill-secondary/60 overflow-hidden backdrop-blur-sm"
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            {/* Header with progress bar */}
            <div className="px-4 py-2.5 flex items-center gap-2.5 text-xs text-text-secondary">
                <span className="font-semibold">Tasks</span>
                <span className="text-text-tertiary">{completed}/{total}</span>
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-primary-mint to-emerald-500 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>
            {/* Task list */}
            <div className="px-4 pb-3 space-y-1">
                {todos.map((t) => (
                    <div
                        key={t.id}
                        className={cn(
                            'flex items-center gap-2.5 py-1 text-xs transition-all duration-300',
                            t.status === 'completed' ? 'text-text-tertiary line-through opacity-60' : 'text-text'
                        )}
                    >
                        <TodoIcon status={t.status} />
                        <span>{t.title}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── Scroll to bottom button ───────────────────────────────────────────────────

const ScrollToBottom: React.FC<{ onClick: () => void; visible: boolean }> = ({ onClick, visible }) => (
    <button
        onClick={onClick}
        className={cn(
            'absolute bottom-28 right-6 z-10 w-9 h-9 rounded-full bg-bg-container border border-border flex items-center justify-center transition-all duration-300',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
        style={{ boxShadow: 'var(--shadow-elevated)' }}
    >
        <ChevronDown size={16} className="text-text-secondary" />
    </button>
)

// ── Chat input ────────────────────────────────────────────────────────────────

const ChatInput: React.FC = () => {
    const {
        inputValue, setInputValue,
        isGenerating, setIsGenerating,
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
        updateLastAssistantThinking, updateLastAssistantTodos, appendToLastAssistantActivity,
        setAbortController, setThinkingStatus,
        selectedModel, setSelectedModel,
    } = useAppStore()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    const handleSend = async () => {
        if (!inputValue.trim() || !activeChatId || isGenerating) return
        const text = inputValue.trim()

        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'user',
            content: text,
            timestamp: Date.now(),
        })
        setInputValue('')
        setIsGenerating(true)
        setThinkingStatus('Thinking…')

        // Placeholder for assistant
        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        })

        const controller = new AbortController()
        setAbortController(controller)
        let accumulated = ''
        let thinkingAccum = ''

        try {
            for await (const chunk of streamChat(text, activeChatId, controller.signal, selectedModel)) {
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'thought') {
                    thinkingAccum += chunk.text ?? ''
                } else if (chunk.type === 'tool_call') {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_call',
                        toolName: chunk.toolName ?? 'tool',
                        args: chunk.args,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_result') {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_result',
                        toolName: chunk.toolName ?? 'tool',
                        result: chunk.result,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus('')
                    accumulated += chunk.text
                    updateLastAssistantMessage(activeChatId, accumulated)
                } else if (chunk.type === 'image' && chunk.url) {
                    setThinkingStatus('')
                    addImageToLastAssistantMessage(activeChatId, chunk.url)
                } else if (chunk.type === 'todo_update' && chunk.todos) {
                    updateLastAssistantTodos(activeChatId, chunk.todos as AgentTodoItem[])
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(activeChatId, `⚠️ ${err instanceof Error ? err.message : 'Request failed'}`)
            }
        } finally {
            if (thinkingAccum) {
                updateLastAssistantThinking(activeChatId, thinkingAccum)
            }
            setIsGenerating(false)
            setThinkingStatus('')
            setAbortController(null)
        }
    }

    const handleStop = () => {
        useAppStore.getState().abortController?.abort()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
        // Escape stops generation
        if (e.key === 'Escape' && isGenerating) {
            e.preventDefault()
            handleStop()
        }
    }

    // Auto-resize textarea
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
        }
    }, [inputValue])

    // Auto-focus when active chat changes
    React.useEffect(() => {
        if (activeChatId && textareaRef.current) {
            textareaRef.current.focus()
        }
    }, [activeChatId])

    return (
        <div className="p-4 bg-bg-container/80 backdrop-blur-xl shrink-0 border-t border-border">
            <div className="max-w-3xl mx-auto">
                <div className="relative bg-fill-secondary/80 border border-border rounded-2xl focus-within:ring-2 focus-within:ring-primary-mint/30 focus-within:border-primary-mint/40 transition-all duration-200"
                     style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything… (Shift+Enter for newline)"
                        className="w-full bg-transparent px-5 pt-3.5 pb-2 pr-14 focus:outline-none resize-none text-sm leading-relaxed placeholder:text-text-quaternary"
                        rows={1}
                    />
                    {/* Bottom bar: model selector + send */}
                    <div className="flex items-center justify-between px-3 pb-2.5">
                        <div className="flex items-center gap-1">
                            {(['flash', 'pro'] as const).map((m) => (
                                <button
                                    key={m}
                                    onClick={() => setSelectedModel(m)}
                                    className={cn(
                                        'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200',
                                        selectedModel === m
                                            ? 'bg-primary-mint/15 text-primary-mint'
                                            : 'text-text-quaternary hover:text-text-tertiary hover:bg-fill'
                                    )}
                                >
                                    {m === 'flash' ? '⚡ Flash' : '✨ Pro'}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            {isGenerating && (
                                <span className="text-[11px] text-text-tertiary hidden sm:inline">
                                    Press Esc to stop
                                </span>
                            )}
                            {isGenerating ? (
                                <button
                                    onClick={handleStop}
                                    className="p-2 bg-text text-bg-container rounded-xl hover:opacity-80 transition-all duration-200 hover:scale-105 active:scale-95"
                                    title="Stop (Esc)"
                                >
                                    <Square size={14} fill="currentColor" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim()}
                                    className={cn(
                                        'p-2 rounded-xl transition-all duration-200',
                                        !inputValue.trim()
                                            ? 'bg-fill text-text-quaternary cursor-not-allowed'
                                            : 'bg-gradient-to-r from-primary-mint to-emerald-500 text-white shadow-sm hover:opacity-90 hover:scale-105 active:scale-95'
                                    )}
                                    title="Send (Enter)"
                                >
                                    <Send size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-[10px] text-text-quaternary text-center mt-2 hidden sm:block">
                    <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Enter</kbd> to send · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Shift+Enter</kbd> newline · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+N</kbd> new chat
                </p>
            </div>
        </div>
    )
}

// ── Chat area ─────────────────────────────────────────────────────────────────

export const ChatArea: React.FC = () => {
    const { chats, activeChatId, messages, isGenerating, thinkingStatus, setMessages } = useAppStore()
    const activeChat = chats.find((c) => c.id === activeChatId)
    const chatMessages = messages[activeChatId ?? ''] ?? []
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [showScrollBtn, setShowScrollBtn] = React.useState(false)

    // Load message history from server when session changes
    React.useEffect(() => {
        if (!activeChatId) return
        // Only load from server if we have no messages in memory yet
        if (messages[activeChatId]?.length) return
        fetchMessages(activeChatId)
            .then((rows) => {
                if (rows.length > 0) {
                    setMessages(activeChatId, rows.map((r) => ({
                        id: r.id,
                        role: r.role as 'user' | 'assistant',
                        content: r.content,
                        timestamp: r.timestamp,
                    })))
                }
            })
            .catch(() => { /* session may not exist yet */ })
    }, [activeChatId])

    // Auto-scroll and track scroll position
    const scrollToBottom = React.useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [])

    React.useEffect(() => {
        scrollToBottom()
    }, [chatMessages, scrollToBottom])

    const handleScroll = React.useCallback(() => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
        setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120)
    }, [])

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden relative">
            {/* Header */}
            <div className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-bg-container/80 backdrop-blur-xl"
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <span className="text-sm font-semibold truncate text-text tracking-tight">
                    {activeChat?.title ?? 'Welcome'}
                </span>
                {isGenerating && thinkingStatus && (
                    <span className="ml-3 text-xs text-text-tertiary flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin text-primary-mint" />
                        {thinkingStatus}
                    </span>
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-8">
                <div className="max-w-3xl mx-auto space-y-7">
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
                                <div className="max-w-[80%] px-5 py-3 bg-user-bubble border border-user-bubble-border rounded-2xl rounded-br-md text-sm leading-relaxed"
                                     style={{ boxShadow: 'var(--shadow-soft)' }}>
                                    {msg.content}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <details className="mb-3 group">
                                            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5 py-1">
                                                <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
                                                💭 Thinking
                                            </summary>
                                            <div className="mt-2 pl-4 border-l-2 border-border/60 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                                                {msg.thinking}
                                            </div>
                                        </details>
                                    )}
                                    {msg.activityLog && msg.activityLog.length > 0 && (
                                        <ActivityPanel
                                            items={msg.activityLog}
                                            isLive={isGenerating && !msg.content}
                                        />
                                    )}
                                    {!msg.content && isGenerating && (!msg.activityLog || msg.activityLog.length === 0) && (
                                        <TypingIndicator />
                                    )}
                                    {msg.todos && msg.todos.length > 0 && (
                                        <TodoPanel todos={msg.todos} />
                                    )}
                                    {msg.content ? (
                                        <MD content={msg.content} />
                                    ) : isGenerating ? null : (
                                        <MessageSkeleton />
                                    )}
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {msg.images.map((src, i) => (
                                                <img
                                                    key={i}
                                                    src={src}
                                                    alt="Generated image"
                                                    className="max-w-sm rounded-2xl border border-border"
                                                    style={{ boxShadow: 'var(--shadow-soft)' }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
            <ChatInput />
        </div>
    )
}
