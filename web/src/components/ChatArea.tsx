import React from 'react'
import { Send, Square } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import { streamChat } from '../api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ── Markdown renderer ─────────────────────────────────────────────────────────

const MD: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
)

// ── Chat input ────────────────────────────────────────────────────────────────

const ChatInput: React.FC = () => {
    const {
        inputValue, setInputValue,
        isGenerating, setIsGenerating,
        activeChatId, addMessage, updateLastAssistantMessage,
        messages, setAbortController,
    } = useAppStore()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    const buildHistory = (chatId: string) => {
        const msgs = messages[chatId] ?? []
        return msgs
            .map((m) => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`))
            .join('\n\n')
    }

    const handleSend = async () => {
        if (!inputValue.trim() || !activeChatId || isGenerating) return
        const text = inputValue.trim()
        const history = buildHistory(activeChatId)

        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'user',
            content: text,
            timestamp: Date.now(),
        })
        setInputValue('')
        setIsGenerating(true)

        // Placeholder for assistant
        const assistantId = Math.random().toString(36).substring(7)
        addMessage(activeChatId, {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        })

        const controller = new AbortController()
        setAbortController(controller)
        let accumulated = ''

        try {
            for await (const chunk of streamChat(text, history, controller.signal)) {
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'text' && chunk.text) {
                    accumulated += chunk.text
                    updateLastAssistantMessage(activeChatId, accumulated)
                }
                // 'thought' chunks are silent in web UI for now
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(activeChatId, `⚠️ ${err instanceof Error ? err.message : 'Request failed'}`)
            }
        } finally {
            setIsGenerating(false)
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
            <div className="max-w-3xl mx-auto relative">
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
    )
}

// ── Chat area ─────────────────────────────────────────────────────────────────

export const ChatArea: React.FC = () => {
    const { chats, activeChatId, messages, isGenerating } = useAppStore()
    const activeChat = chats.find((c) => c.id === activeChatId)
    const chatMessages = messages[activeChatId ?? ''] ?? []
    const scrollRef = React.useRef<HTMLDivElement>(null)

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
                {isGenerating && (
                    <span className="ml-3 text-xs text-text-tertiary animate-pulse">Thinking…</span>
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
                                    {msg.content ? (
                                        <MD content={msg.content} />
                                    ) : (
                                        <span className="text-text-tertiary italic text-xs">
                                            ● ● ●
                                        </span>
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
