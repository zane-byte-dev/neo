/**
 * NotebookChat — middle column of the notebook workspace.
 * Source-grounded chat with 【N】 citations.
 */
import React from 'react'
import { Send, Trash2, Loader2, Sparkles, MessageSquare } from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import {
    streamNotebookChat,
    notebookChatHistory,
    notebookClearChat,
    notebookSaveNote,
    type NotebookChatEvent,
} from '../../api'
import { CitationRenderer } from './CitationRenderer'
import type { NotebookChatMessage } from '../../types'

interface Props { notebook: string }

export const NotebookChat: React.FC<Props> = ({ notebook }) => {
    const {
        sources,
        selectedSourceIds,
        notebookMessages,
        setNotebookMessages,
        appendNotebookMessage,
        updateLastNotebookMessage,
        sourceGuides,
    } = useAppStore()
    const [input, setInput] = React.useState('')
    const [sending, setSending] = React.useState(false)
    const abortRef = React.useRef<AbortController | null>(null)
    const scrollRef = React.useRef<HTMLDivElement>(null)

    // Load chat history
    React.useEffect(() => {
        notebookChatHistory(notebook)
            .then((msgs) => setNotebookMessages(msgs.map((m) => ({ ...m, id: m.id || String(m.timestamp) }))))
            .catch(() => setNotebookMessages([]))
    }, [notebook, setNotebookMessages])

    // Auto-scroll
    React.useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, [notebookMessages.length])

    // Gather suggested questions from first selected source guide
    const suggestedQuestions = React.useMemo(() => {
        const firstSelected = sources.find((s) => selectedSourceIds.includes(s.id))
        if (!firstSelected) return []
        return sourceGuides[firstSelected.id]?.suggestedQuestions ?? []
    }, [sources, selectedSourceIds, sourceGuides])

    const sendMessage = async (text: string) => {
        if (!text.trim() || sending) return
        if (selectedSourceIds.length === 0) {
            alert('请先选择至少一个来源')
            return
        }

        const userMsg: NotebookChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: text,
            timestamp: Date.now(),
        }
        appendNotebookMessage(userMsg)

        const assistantMsg: NotebookChatMessage = {
            id: `asst-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now() + 1,
            streaming: true,
        }
        appendNotebookMessage(assistantMsg)

        setSending(true)
        setInput('')
        const controller = new AbortController()
        abortRef.current = controller

        try {
            let full = ''
            let meta: { n: number; sourceId: string; title: string }[] = []
            for await (const evt of streamNotebookChat(notebook, text, selectedSourceIds, controller.signal) as AsyncGenerator<NotebookChatEvent>) {
                if (evt.type === 'meta' && evt.sources) {
                    meta = evt.sources
                    updateLastNotebookMessage({ citedSources: meta })
                } else if (evt.type === 'text' && evt.text) {
                    full += evt.text
                    updateLastNotebookMessage({ content: full })
                } else if (evt.type === 'citations' && evt.citations) {
                    updateLastNotebookMessage({ citations: evt.citations })
                } else if (evt.type === 'error') {
                    updateLastNotebookMessage({ content: full + `\n\n**错误：** ${evt.error}`, streaming: false })
                    break
                } else if (evt.type === 'done') {
                    updateLastNotebookMessage({ streaming: false })
                }
            }
            updateLastNotebookMessage({ streaming: false })
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                updateLastNotebookMessage({ content: `**错误：** ${(err as Error).message}`, streaming: false })
            } else {
                updateLastNotebookMessage({ streaming: false })
            }
        } finally {
            setSending(false)
            abortRef.current = null
        }
    }

    const clear = async () => {
        if (!confirm('清空当前对话？')) return
        await notebookClearChat(notebook)
        setNotebookMessages([])
    }

    const saveAsNote = async (msg: NotebookChatMessage) => {
        try {
            await notebookSaveNote(notebook, {
                title: msg.content.slice(0, 40).replace(/\n.*/s, '').trim() || 'AI 回答',
                content: msg.content,
                source: 'ai-chat',
            })
            alert('已保存到笔记')
        } catch (e) {
            alert(`保存失败：${(e as Error).message}`)
        }
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <div className="h-14 border-b border-border flex items-center gap-2 px-4 shrink-0">
                <MessageSquare size={15} className="text-primary-mint" />
                <span className="text-sm font-semibold flex-1">对话</span>
                {notebookMessages.length > 0 && (
                    <button
                        onClick={clear}
                        className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary hover:text-destructive transition-colors"
                        title="清空对话"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-4">
                {notebookMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-quaternary max-w-md mx-auto">
                        <div className="w-12 h-12 rounded-2xl bg-fill flex items-center justify-center">
                            <Sparkles size={20} className="text-primary-mint" />
                        </div>
                        <p className="text-sm text-center">基于所选来源向我提问</p>
                        {suggestedQuestions.length > 0 && (
                            <div className="w-full space-y-2 mt-2">
                                <p className="text-xs text-text-tertiary text-center">💡 推荐问题</p>
                                {suggestedQuestions.slice(0, 4).map((q, i) => (
                                    <button
                                        key={i}
                                        onClick={() => sendMessage(q)}
                                        className="w-full text-left text-xs px-3 py-2 bg-fill-secondary hover:bg-fill rounded-lg transition-colors text-text-secondary"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {notebookMessages.map((m) => (
                    <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-primary-mint text-white' : 'bg-bg-container border border-border'}`}>
                            {m.role === 'user'
                                ? <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                                : (
                                    <>
                                        <CitationRenderer content={m.content} sources={m.citedSources} />
                                        {m.streaming && !m.content && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
                                        {!m.streaming && m.content && (
                                            <div className="mt-2 pt-2 border-t border-border-secondary flex items-center gap-2">
                                                <button
                                                    onClick={() => saveAsNote(m)}
                                                    className="text-xs text-text-tertiary hover:text-primary-mint transition-colors"
                                                >
                                                    📌 保存为笔记
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )
                            }
                        </div>
                    </div>
                ))}
            </div>

            <div className="border-t border-border p-3 shrink-0">
                <div className="flex gap-2 items-end">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                sendMessage(input)
                            }
                        }}
                        placeholder={selectedSourceIds.length ? '基于所选来源提问…' : '请先选择来源'}
                        rows={1}
                        className="flex-1 bg-fill-secondary border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none max-h-32"
                    />
                    <button
                        onClick={() => sendMessage(input)}
                        disabled={sending || !input.trim() || !selectedSourceIds.length}
                        className="p-2.5 bg-primary-mint text-white rounded-xl disabled:opacity-40 hover:bg-primary-mint/90 transition-colors"
                    >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
                <div className="text-[10px] text-text-tertiary mt-1.5 text-center">
                    已选 {selectedSourceIds.length} / {sources.length} 个来源 · 引用 【N】 可点击跳转
                </div>
            </div>
        </div>
    )
}
