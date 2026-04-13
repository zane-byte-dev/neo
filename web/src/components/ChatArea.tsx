import React from 'react'
import { Send, Square, CheckCircle2, Circle, Loader2, ChevronRight, Wrench } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import { streamChat, fetchMessages } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ActivityItem, AgentTodoItem } from '../types'

// ── Markdown renderer ─────────────────────────────────────────────────────────

const MD: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
                'space-y-0.5 font-mono text-xs leading-relaxed overflow-y-auto',
                isLive ? 'max-h-40' : 'max-h-52 mt-1.5'
            )}
        >
            {items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-1.5 min-w-0 animate-activity-in">
                    {item.type === 'tool_call' ? (
                        <>
                            <Wrench size={11} className="text-primary-mint shrink-0 mt-0.5" />
                            <span className="text-text-secondary shrink-0">{item.toolName}</span>
                            {item.args && (
                                <span className="text-text-tertiary truncate">
                                    {JSON.stringify(item.args)}
                                </span>
                            )}
                        </>
                    ) : (
                        <>
                            <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                            <span className="text-text-tertiary shrink-0">{item.toolName}</span>
                            {item.result && (
                                <span className="text-text-tertiary/70 truncate">
                                    → {item.result}
                                </span>
                            )}
                        </>
                    )}
                </div>
            ))}
            {isLive && (
                <div className="flex items-center gap-1 text-text-tertiary animate-pulse">
                    <span className="w-1 h-1 rounded-full bg-primary-mint inline-block" />
                    <span className="w-1 h-1 rounded-full bg-primary-mint inline-block" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 rounded-full bg-primary-mint inline-block" style={{ animationDelay: '300ms' }} />
                </div>
            )}
        </div>
    )

    if (isLive) {
        return (
            <div className="mb-3 rounded-xl border border-border bg-fill-secondary/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1.5">
                    <Loader2 size={11} className="animate-spin text-primary-mint" />
                    <span>Working…</span>
                </div>
                {content}
            </div>
        )
    }

    return (
        <details className="mb-3 group">
            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                <Wrench size={11} className="text-text-tertiary" />
                {summary}
            </summary>
            <div className="mt-1.5 pl-4 border-l-2 border-border">
                {content}
            </div>
        </details>
    )
}

// ── Todo panel (inline progress tracker) ──────────────────────────────────────

const TodoIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'completed':
            return <CheckCircle2 size={14} className="text-green-500 shrink-0" />
        case 'in-progress':
            return <Loader2 size={14} className="text-primary-mint shrink-0 animate-spin" />
        default:
            return <Circle size={14} className="text-text-tertiary shrink-0" />
    }
}

const TodoPanel: React.FC<{ todos: AgentTodoItem[] }> = ({ todos }) => {
    const completed = todos.filter(t => t.status === 'completed').length
    const total = todos.length
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0

    return (
        <div className="my-3 rounded-xl border border-border bg-fill-secondary/50 overflow-hidden">
            {/* Header with progress bar */}
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-text-secondary">
                <span className="font-medium">Tasks</span>
                <span className="text-text-tertiary">{completed}/{total}</span>
                <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary-mint rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>
            {/* Task list */}
            <div className="px-3 pb-2 space-y-0.5">
                {todos.map((t) => (
                    <div
                        key={t.id}
                        className={cn(
                            'flex items-center gap-2 py-1 text-xs',
                            t.status === 'completed' ? 'text-text-tertiary line-through' : 'text-text'
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
    }

    // Auto-resize textarea
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
        }
    }, [inputValue])

    return (
        <div className="p-4 border-t border-border bg-bg-container shrink-0">
            <div className="max-w-3xl mx-auto">
                {/* Model selector */}
                <div className="flex items-center gap-1.5 mb-2">
                    {(['flash', 'pro'] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => setSelectedModel(m)}
                            className={cn(
                                'px-2.5 py-0.5 rounded-full text-xs font-medium transition-all',
                                selectedModel === m
                                    ? 'bg-primary-mint text-bg-container'
                                    : 'bg-fill-secondary text-text-tertiary hover:text-text'
                            )}
                        >
                            {m === 'flash' ? 'Flash' : 'Pro'}
                        </button>
                    ))}
                </div>
                <div className="relative">
                <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything… (Shift+Enter for newline)"
                    className="w-full bg-fill-secondary border border-border rounded-2xl px-4 py-3 pr-14 focus:outline-none focus:ring-1 focus:ring-primary-mint transition-all resize-none text-sm leading-relaxed"
                    rows={1}
                />
                <div className="absolute bottom-2.5 right-2.5">
                    {isGenerating ? (
                        <button
                            onClick={handleStop}
                            className="p-2 bg-text text-bg-container rounded-xl hover:opacity-80 transition-opacity"
                            title="Stop"
                        >
                            <Square size={15} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!inputValue.trim()}
                            className={cn(
                                'p-2 bg-text text-bg-container rounded-xl transition-all',
                                !inputValue.trim() ? 'opacity-30 cursor-not-allowed' : 'hover:opacity-80'
                            )}
                            title="Send"
                        >
                            <Send size={15} fill="currentColor" />
                        </button>
                    )}
                </div>
                </div>
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

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [chatMessages])

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden">
            {/* Header */}
            <div className="h-12 border-b border-border flex items-center px-5 shrink-0">
                <span className="text-sm font-semibold truncate text-text">
                    {activeChat?.title ?? 'Welcome'}
                </span>
                {isGenerating && thinkingStatus && (
                    <span className="ml-3 text-xs text-text-tertiary animate-pulse">{thinkingStatus}</span>
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {chatMessages.length === 0 && <WelcomeScreen />}

                    {chatMessages.map((msg) => (
                        <div
                            key={msg.id}
                            className={cn(
                                'flex flex-col gap-1 w-full animate-slide-up',
                                msg.role === 'user' ? 'items-end' : 'items-start'
                            )}
                        >
                            {msg.role === 'user' ? (
                                <div className="max-w-[80%] px-4 py-2.5 bg-fill rounded-2xl text-sm leading-relaxed">
                                    {msg.content}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <details className="mb-3 group">
                                            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5">
                                                <span className="transition-transform group-open:rotate-90">▶</span>
                                                💭 Thinking
                                            </summary>
                                            <div className="mt-2 pl-4 border-l-2 border-border text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
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
                                        <div className="mb-3 rounded-xl border border-border bg-fill-secondary/50 p-3">
                                            <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                                                <Loader2 size={11} className="animate-spin text-primary-mint" />
                                                <span>Thinking…</span>
                                            </div>
                                        </div>
                                    )}
                                    {msg.todos && msg.todos.length > 0 && (
                                        <TodoPanel todos={msg.todos} />
                                    )}
                                    {msg.content ? (
                                        <MD content={msg.content} />
                                    ) : isGenerating ? null : (
                                        <span className="text-text-tertiary italic text-xs">
                                            ● ● ●
                                        </span>
                                    )}
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {msg.images.map((src, i) => (
                                                <img
                                                    key={i}
                                                    src={src}
                                                    alt="Generated image"
                                                    className="max-w-sm rounded-xl border border-border"
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

            <ChatInput />
        </div>
    )
}
