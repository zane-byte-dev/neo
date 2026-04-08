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
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
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

        try {
            for await (const chunk of streamChat(text, activeChatId, controller.signal, selectedModel)) {
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'thought') {
                    setThinkingStatus('Thinking…')
                } else if (chunk.type === 'tool_call') {
                    setThinkingStatus(`Calling ${chunk.toolName ?? 'tool'}…`)
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus('')
                    accumulated += chunk.text
                    updateLastAssistantMessage(activeChatId, accumulated)
                } else if (chunk.type === 'image' && chunk.data && chunk.mimeType) {
                    setThinkingStatus('')
                    const dataUrl = `data:${chunk.mimeType};base64,${chunk.data}`
                    addImageToLastAssistantMessage(activeChatId, dataUrl)
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(activeChatId, `⚠️ ${err instanceof Error ? err.message : 'Request failed'}`)
            }
        } finally {
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
    const { chats, activeChatId, messages, isGenerating, thinkingStatus } = useAppStore()
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
                                    {msg.content ? (
                                        <MD content={msg.content} />
                                    ) : isGenerating && thinkingStatus ? (
                                        <span className="inline-flex items-center gap-1.5 text-text-tertiary text-xs animate-pulse">
                                            <span className="w-1.5 h-1.5 rounded-full bg-primary-mint inline-block" />
                                            {thinkingStatus}
                                        </span>
                                    ) : (
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
