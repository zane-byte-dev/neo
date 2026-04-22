import React from 'react'
import { Send, Square, CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown, Wrench, ImagePlus, X, Download, Paperclip, FileText, FileSpreadsheet, File as FileIcon, Volume2, VolumeX, ShieldCheck, ShieldOff } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import { streamChat, fetchMessages, uploadFiles, confirmTool, fetchToolResult } from '../api'
import { t } from '../i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { ActivityItem, AgentTodoItem, FileAttachment, Message } from '../types'
import { CodeBlock, InlineCode } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

// ── Export chat as Markdown ───────────────────────────────────────────────────

const MAX_EXPORT_FILENAME_LENGTH = 50

function exportChatAsMarkdown(title: string, messages: Message[]) {
    const lines = [`# ${title}\n`]
    for (const msg of messages) {
        const role = msg.role === 'user' ? t('you') : t('neo')
        lines.push(`### ${role}\n`)
        if (msg.content) lines.push(msg.content + '\n')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '_').slice(0, MAX_EXPORT_FILENAME_LENGTH)}.md`
    a.click()
    URL.revokeObjectURL(url)
}

// ── Text-to-speech ────────────────────────────────────────────────────────────

function speakText(text: string) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const plain = text
        .replace(/```[\s\S]*?```/g, '') // code blocks
        .replace(/`[^`]+`/g, '')        // inline code
        .replace(/#{1,6}\s+/g, '')      // headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/\*([^*]+)\*/g, '$1') // italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/^[-*+]\s+/gm, '')    // unordered list
        .replace(/^\d+\.\s+/gm, '')    // ordered list
        .replace(/\n{2,}/g, ' ')
        .trim()
    if (!plain) return
    const utt = new SpeechSynthesisUtterance(plain)
    window.speechSynthesis.speak(utt)
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

const markdownComponents: import('react-markdown').Components = {
    pre({ children }) {
        return <>{children}</>
    },
    code({ className, children, ...rest }) {
        const match = /language-(\w+)/.exec(className || '')
        const text = String(children).replace(/\n$/, '')

        // Mermaid diagrams — render as SVG
        if (match?.[1] === 'mermaid') {
            return <MermaidBlock>{text}</MermaidBlock>
        }

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
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
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
            <span className="text-xs text-text-tertiary ml-1">{t('thinking')}</span>
        </div>
    </div>
)

// ── Activity panel (live tool call log) ───────────────────────────────────────

const ActivityPanel: React.FC<{ items: ActivityItem[]; isLive?: boolean; sessionId?: string | null }> = ({ items, isLive, sessionId }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [expandedResults, setExpandedResults] = React.useState<Record<string, string>>({})
    const [expanding, setExpanding] = React.useState<Record<string, boolean>>({})
    const updateActivityConfirmStatus = useAppStore(s => s.updateActivityConfirmStatus)

    React.useEffect(() => {
        if (isLive && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [items.length, isLive])

    const callCount = items.filter(i => i.type === 'tool_call').length
    const summary = callCount === 1 ? t('toolCall', { n: 1 }) : t('toolCalls', { n: callCount })

    const handleConfirm = async (confirmId: string, approved: boolean) => {
        if (!sessionId) return
        // Optimistic UI update, then call server.
        updateActivityConfirmStatus(sessionId, confirmId, approved ? 'approved' : 'denied')
        try {
            await confirmTool(confirmId, approved)
        } catch {
            // Silently ignore — server will time out and auto-deny anyway.
        }
    }

    const handleExpand = async (resultId: string) => {
        if (expandedResults[resultId] || expanding[resultId]) return
        setExpanding(s => ({ ...s, [resultId]: true }))
        try {
            const full = await fetchToolResult(resultId)
            setExpandedResults(s => ({ ...s, [resultId]: full.result }))
        } catch {
            // Leave truncated view in place on error.
        } finally {
            setExpanding(s => ({ ...s, [resultId]: false }))
        }
    }

    const content = (
        <div
            ref={scrollRef}
            className={cn(
                'space-y-1 font-mono text-xs leading-relaxed overflow-y-auto custom-scrollbar',
                isLive ? 'max-h-44' : 'max-h-52 mt-2'
            )}
        >
            {items.map((item, idx) => {
                if (item.type === 'tool_call') {
                    return (
                        <div key={idx} className="flex items-start gap-2 min-w-0 animate-activity-in py-0.5">
                            <Wrench size={11} className="text-primary-mint shrink-0 mt-0.5" />
                            <span className="text-text-secondary shrink-0 font-medium">{item.toolName}</span>
                            {item.args && (
                                <span className="text-text-tertiary truncate">
                                    {JSON.stringify(item.args)}
                                </span>
                            )}
                        </div>
                    )
                }
                if (item.type === 'tool_confirm') {
                    const status = item.confirmStatus ?? 'pending'
                    return (
                        <div key={idx} className="flex flex-col gap-1 min-w-0 animate-activity-in py-1">
                            <div className="flex items-start gap-2 min-w-0">
                                <span className="text-warning shrink-0 mt-0.5 text-[11px]">⚠</span>
                                <span className="text-text-secondary shrink-0 font-medium">{item.toolName}</span>
                                {item.args && (
                                    <span className="text-text-tertiary truncate">
                                        {JSON.stringify(item.args)}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 pl-5">
                                {status === 'pending' ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => item.confirmId && handleConfirm(item.confirmId, true)}
                                            className="px-2 py-0.5 text-[11px] rounded-md bg-primary-mint text-white hover:opacity-90 transition"
                                        >
                                            Approve
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => item.confirmId && handleConfirm(item.confirmId, false)}
                                            className="px-2 py-0.5 text-[11px] rounded-md bg-fill-tertiary text-text-secondary hover:bg-fill-quaternary transition"
                                        >
                                            Deny
                                        </button>
                                    </>
                                ) : (
                                    <span className="text-[11px] text-text-tertiary">
                                        {status === 'approved' ? '✓ approved' : '✗ denied'}
                                    </span>
                                )}
                            </div>
                        </div>
                    )
                }
                // tool_result
                const fullResult = item.resultId ? expandedResults[item.resultId] : undefined
                const shownResult = fullResult ?? item.result
                return (
                    <div key={idx} className="flex items-start gap-2 min-w-0 animate-activity-in py-0.5">
                        <span className="text-success shrink-0 mt-0.5 text-[10px]">✓</span>
                        <span className="text-text-tertiary shrink-0">{item.toolName}</span>
                        {shownResult && (
                            <span className={cn('text-text-tertiary/60 min-w-0', fullResult ? 'whitespace-pre-wrap break-words' : 'truncate')}>
                                → {shownResult}
                            </span>
                        )}
                        {item.truncated && item.resultId && !fullResult && (
                            <button
                                type="button"
                                onClick={() => item.resultId && handleExpand(item.resultId)}
                                className="shrink-0 text-[10px] text-primary-mint hover:underline"
                                disabled={!!expanding[item.resultId]}
                            >
                                {expanding[item.resultId] ? '…' : 'expand'}
                            </button>
                        )}
                    </div>
                )
            })}
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
                    <span className="font-medium">{t('working')}</span>
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
                <span className="font-semibold">{t('tasks')}</span>
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

// ── File attachment helper ────────────────────────────────────────────────────

const FileAttachmentIcon: React.FC<{ filename: string; className?: string }> = ({ filename, className }) => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'pdf') return <FileText size={14} className={className ?? 'text-red-400'} />
    if (ext === 'docx' || ext === 'doc') return <FileText size={14} className={className ?? 'text-blue-400'} />
    if (ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet size={14} className={className ?? 'text-green-400'} />
    return <FileIcon size={14} className={className ?? 'text-text-tertiary'} />
}

// ── Chat input ────────────────────────────────────────────────────────────────

interface PendingDocument {
    filename: string
    text: string
    pageCount?: number
    mimeType?: string
}

const ChatInput: React.FC = () => {
    const {
        inputValue, setInputValue,
        isGenerating, setIsGenerating,
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
        addVideoToLastAssistantMessage,
        updateLastAssistantThinking, updateLastAssistantTodos, appendToLastAssistantActivity,
        setAbortController, setThinkingStatus,
        selectedModel, setSelectedModel,
        autoSpeak, setAutoSpeak,
        confirmDangerous, setConfirmDangerous,
    } = useAppStore()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const docInputRef = React.useRef<HTMLInputElement>(null)
    const [pendingImages, setPendingImages] = React.useState<string[]>([])
    const [pendingDocs, setPendingDocs] = React.useState<PendingDocument[]>([])
    const [isUploading, setIsUploading] = React.useState(false)

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            if (file.size > 10 * 1024 * 1024) continue // 10MB limit per image
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }
        e.target.value = '' // reset so same file can be re-selected
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files
        if (!fileList) return
        const files = Array.from(fileList).filter(f => f.size <= 20 * 1024 * 1024)
        if (files.length === 0) return

        setIsUploading(true)
        try {
            const results = await uploadFiles(files)
            for (const r of results) {
                if (r.type === 'image') {
                    setPendingImages((prev) => [...prev, r.dataUrl])
                } else if (r.type === 'document') {
                    setPendingDocs((prev) => [...prev, {
                        filename: r.filename,
                        text: r.text,
                        pageCount: r.pageCount,
                        mimeType: r.mimeType,
                    }])
                }
            }
        } catch (err) {
            console.error('File upload failed:', err)
        } finally {
            setIsUploading(false)
            e.target.value = ''
        }
    }

    const removeImage = (idx: number) => {
        setPendingImages((prev) => prev.filter((_, i) => i !== idx))
    }

    const removeDoc = (idx: number) => {
        setPendingDocs((prev) => prev.filter((_, i) => i !== idx))
    }

    const handleSend = async () => {
        if ((!inputValue.trim() && !pendingImages.length && !pendingDocs.length) || !activeChatId || isGenerating) return
        // Cancel any ongoing speech when user sends a new message
        window.speechSynthesis?.cancel()
        const text = inputValue.trim()
        const images = pendingImages.length ? [...pendingImages] : undefined
        const documents = pendingDocs.length ? [...pendingDocs] : undefined

        // Build file attachments for the message record
        const fileAttachments: FileAttachment[] = [
            ...(documents?.map(d => ({
                filename: d.filename,
                type: 'document' as const,
                preview: d.text.slice(0, 200),
                pageCount: d.pageCount,
                mimeType: d.mimeType,
            })) ?? []),
        ]

        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'user',
            content: text,
            images,
            files: fileAttachments.length > 0 ? fileAttachments : undefined,
            timestamp: Date.now(),
        })
        setInputValue('')
        setPendingImages([])
        setPendingDocs([])
        setIsGenerating(true)
        setThinkingStatus(t('thinking'))

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
            for await (const chunk of streamChat(
                text, activeChatId, controller.signal, selectedModel, images,
                documents?.map(d => ({ filename: d.filename, text: d.text })),
                confirmDangerous,
            )) {
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
                        resultId: chunk.resultId,
                        truncated: chunk.truncated,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_confirm' && chunk.confirmId) {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_confirm',
                        toolName: chunk.toolName ?? 'tool',
                        args: chunk.args,
                        confirmId: chunk.confirmId,
                        confirmStatus: 'pending',
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus('')
                    accumulated += chunk.text
                    updateLastAssistantMessage(activeChatId, accumulated)
                } else if (chunk.type === 'image' && chunk.url) {
                    setThinkingStatus('')
                    addImageToLastAssistantMessage(activeChatId, chunk.url)
                } else if (chunk.type === 'video' && chunk.url) {
                    setThinkingStatus('')
                    addVideoToLastAssistantMessage(activeChatId, chunk.url)
                } else if (chunk.type === 'todo_update' && chunk.todos) {
                    updateLastAssistantTodos(activeChatId, chunk.todos as AgentTodoItem[])
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(activeChatId, `⚠️ ${err instanceof Error ? err.message : t('requestFailed')}`)
            }
        } finally {
            if (thinkingAccum) {
                updateLastAssistantThinking(activeChatId, thinkingAccum)
            }
            if (autoSpeak && accumulated) {
                speakText(accumulated)
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
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSend()
        }
        // Escape stops generation
        if (e.key === 'Escape' && isGenerating) {
            e.preventDefault()
            handleStop()
        }
    }

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items
        const imageFiles: File[] = []
        const docFiles: File[] = []

        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault()
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
            } else if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file && !file.type.startsWith('image/')) {
                    e.preventDefault()
                    docFiles.push(file)
                }
            }
        }

        // Handle images inline (as before)
        for (const file of imageFiles) {
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }

        // Handle document files via upload
        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const r of results) {
                    if (r.type === 'image') {
                        setPendingImages((prev) => [...prev, r.dataUrl])
                    } else if (r.type === 'document') {
                        setPendingDocs((prev) => [...prev, {
                            filename: r.filename,
                            text: r.text,
                            pageCount: r.pageCount,
                            mimeType: r.mimeType,
                        }])
                    }
                }
            } catch (err) {
                console.error('Paste file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
        }
    }

    // Drag-and-drop handler
    const [isDragOver, setIsDragOver] = React.useState(false)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)

        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return

        const imageFiles = files.filter(f => f.type.startsWith('image/'))
        const docFiles = files.filter(f => !f.type.startsWith('image/'))

        // Handle images inline
        for (const file of imageFiles) {
            if (file.size > 10 * 1024 * 1024) continue
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }

        // Handle documents via upload
        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const r of results) {
                    if (r.type === 'image') {
                        setPendingImages((prev) => [...prev, r.dataUrl])
                    } else if (r.type === 'document') {
                        setPendingDocs((prev) => [...prev, {
                            filename: r.filename,
                            text: r.text,
                            pageCount: r.pageCount,
                            mimeType: r.mimeType,
                        }])
                    }
                }
            } catch (err) {
                console.error('Drop file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
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
        <div className="p-3 sm:p-4 bg-bg-container/80 backdrop-blur-xl shrink-0 border-t border-border safe-bottom">
            <div className="max-w-3xl mx-auto min-w-0">
                {/* Attachment previews */}
                {(pendingImages.length > 0 || pendingDocs.length > 0) && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {pendingImages.map((src, i) => (
                            <div key={`img-${i}`} className="relative group">
                                <img src={src} alt="" className="h-16 w-16 object-cover rounded-xl border border-border" />
                                <button
                                    onClick={() => removeImage(i)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-text text-bg-container flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {pendingDocs.map((doc, i) => (
                            <div key={`doc-${i}`} className="relative group flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs">
                                <FileAttachmentIcon filename={doc.filename} />
                                <span className="text-text-secondary max-w-[120px] truncate">{doc.filename}</span>
                                {doc.pageCount && <span className="text-text-quaternary">({doc.pageCount}p)</span>}
                                <button
                                    onClick={() => removeDoc(i)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-text text-bg-container flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {isUploading && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs text-text-tertiary">
                                <Loader2 size={14} className="animate-spin" />
                                <span>{t('uploading')}</span>
                            </div>
                        )}
                    </div>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageSelect}
                />
                <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.json,.csv,.xml,.yaml,.yml,.log,.html,.htm,.js,.ts,.py,.sh,.css,.sql"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                />
                <div
                     className={cn(
                         "relative bg-fill-secondary/80 border rounded-2xl focus-within:ring-2 focus-within:ring-primary-mint/30 focus-within:border-primary-mint/40 transition-all duration-200",
                         isDragOver ? 'border-primary-mint border-dashed bg-primary-mint/5' : 'border-border'
                     )}
                     style={{ boxShadow: 'var(--shadow-soft)' }}
                     onDragOver={handleDragOver}
                     onDragLeave={handleDragLeave}
                     onDrop={handleDrop}
                >
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={t('askAnything')}
                        className="w-full bg-transparent px-5 pt-3.5 pb-2 pr-14 focus:outline-none resize-none text-sm leading-relaxed placeholder:text-text-tertiary"
                        rows={1}
                    />
                    {/* Bottom bar: image upload + model selector + send */}
                    <div className="flex items-center justify-between px-3 pb-2.5 gap-2 min-w-0">
                        <div className="flex items-center gap-1 min-w-0 flex-1 mobile-scroll-x">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-all duration-150 shrink-0 cursor-pointer"
                                title={t('uploadImage')}
                                type="button"
                            >
                                <ImagePlus size={16} />
                            </button>
                            <button
                                onClick={() => docInputRef.current?.click()}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-all duration-150 shrink-0 cursor-pointer"
                                title={t('attachFile')}
                                type="button"
                                disabled={isUploading}
                            >
                                <Paperclip size={16} />
                            </button>
                            <button
                                onClick={() => {
                                    const next = !autoSpeak
                                    setAutoSpeak(next)
                                    if (!next) window.speechSynthesis?.cancel()
                                }}
                                className={cn(
                                    'p-1.5 rounded-lg transition-all duration-150 shrink-0 cursor-pointer',
                                    autoSpeak
                                        ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                                        : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                                )}
                                title={autoSpeak ? t('autoSpeakOn') : t('autoSpeakOff')}
                                type="button"
                            >
                                {autoSpeak ? <Volume2 size={16} /> : <VolumeX size={16} />}
                            </button>
                            <button
                                onClick={() => setConfirmDangerous(!confirmDangerous)}
                                className={cn(
                                    'p-1.5 rounded-lg transition-all duration-150 shrink-0 cursor-pointer',
                                    confirmDangerous
                                        ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                                        : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                                )}
                                title={confirmDangerous ? '高危操作需确认：开' : '高危操作需确认：关'}
                                type="button"
                            >
                                {confirmDangerous ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                            </button>
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}
                                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-fill/60 text-text-secondary border border-transparent hover:border-border hover:bg-fill focus:outline-none focus:border-primary-mint/30 focus:text-primary-mint transition-all duration-150 cursor-pointer shrink-0"
                            >
                                <option value="auto">🧠 Auto</option>
                                <option value="flash">⚡ Flash</option>
                                <option value="pro">✨ Pro</option>
                                <option value="deepseek">🐋 DeepSeek</option>
                                <option value="gemma">🦙 Gemma</option>
                                <option value="gemini-acp">💎 Gemini</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {isGenerating && (
                                <span className="text-[11px] text-text-tertiary hidden sm:inline">
                                    {t('pressEscToStop')}
                                </span>
                            )}
                            {isGenerating ? (
                                <button
                                    onClick={handleStop}
                                    className="p-2 bg-text text-bg-container rounded-xl hover:opacity-80 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
                                    title={t('stopEsc')}
                                >
                                    <Square size={14} fill="currentColor" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim() && !pendingImages.length && !pendingDocs.length}
                                    className={cn(
                                        'p-2 rounded-xl transition-all duration-200',
                                        !inputValue.trim() && !pendingImages.length && !pendingDocs.length
                                            ? 'bg-fill text-text-tertiary cursor-not-allowed'
                                            : 'bg-gradient-to-r from-primary-mint to-emerald-500 text-white shadow-sm hover:opacity-90 hover:scale-105 active:scale-95 cursor-pointer'
                                    )}
                                    title={t('sendEnter')}
                                >
                                    <Send size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-[10px] text-text-quaternary text-center mt-2 hidden sm:block">
                    <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Enter</kbd> {t('enterToSend')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Shift+Enter</kbd> {t('shiftEnterNewline')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+N</kbd> {t('newChatShortcut')}
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
                {activeChat && chatMessages.length > 0 && !isGenerating && (
                    <button
                        onClick={() => exportChatAsMarkdown(activeChat.title, chatMessages)}
                        className="ml-2 p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-colors shrink-0 cursor-pointer"
                        title={t('exportMarkdown')}
                    >
                        <Download size={14} />
                    </button>
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
                                        <div className="px-4 sm:px-5 py-2.5 sm:py-3 bg-user-bubble border border-user-bubble-border rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap break-words"
                                             style={{ boxShadow: 'var(--shadow-soft)', overflowWrap: 'anywhere' }}>
                                            {msg.content}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <details className="mb-3 group">
                                            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5 py-1">
                                                <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
                                                {t('thinkingLabel')}
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
                                            sessionId={activeChatId}
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
