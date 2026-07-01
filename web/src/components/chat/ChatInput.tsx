import React from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, ImagePlus, Loader2, Mic, MicOff, Paperclip, Plus, Send, ShieldCheck, ShieldOff, Square, X } from 'lucide-react'
import {
    cancelRun,
    fetchPreferences,
    patchSession,
    streamChat,
    transcribeAudio,
    uploadFiles,
} from '../../api'
import { t } from '../../i18n'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/useAppStore'
import type { AgentTodoItem, FileAttachment } from '../../types'
import { toast } from '../Toast'
import { ProjectPicker } from '../ProjectPicker'
import { ModelPicker } from './ModelPicker'
import { FileAttachmentIcon } from './MessageParts'
import { semanticPreview, toolDisplayName } from './activity-utils'

interface PendingDocument {
    filename: string
    text: string
    pageCount?: number
    mimeType?: string
}

export interface SlashCommand {
    id: string
    label: string
    icon?: React.ComponentType<{ size?: number; className?: string }>
    description?: string
}

export const ChatInput: React.FC<{
    onOpenToolApprovals: () => void
    slashCommands?: SlashCommand[]
    onSlashCommand?: (id: string) => void
}> = ({ onOpenToolApprovals, slashCommands, onSlashCommand }) => {
    const {
        inputValue, setInputValue,
        pendingQuickReply, setPendingQuickReply,
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
        addVideoToLastAssistantMessage,
        updateLastAssistantThinking, updateLastAssistantTodos, appendToLastAssistantActivity, updateActivityConfirmStatus,
        setLastAssistantCitations,
        chats,
        setIsGenerating,
        setCurrentRunId, setAbortController, setThinkingStatus,
        selectedModel, setSelectedModel,
        setChatModel,
        confirmDangerous, setConfirmDangerous,
    } = useAppStore()
    const isGenerating = useAppStore((state) => activeChatId ? !!state.generatingBySession[activeChatId] : false)
    const activeRunId = useAppStore((state) => activeChatId ? (state.currentRunIdBySession[activeChatId] ?? null) : null)

    const prevChatIdRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (activeChatId && activeChatId !== prevChatIdRef.current) {
            prevChatIdRef.current = activeChatId
            const chat = chats.find((item) => item.id === activeChatId)
            if (chat?.chatModel) setSelectedModel(chat.chatModel)
        }
    }, [activeChatId, chats, setSelectedModel])

    const handleModelSelect = React.useCallback((model: string) => {
        setSelectedModel(model as typeof selectedModel)
        if (activeChatId) {
            setChatModel(activeChatId, model)
            patchSession(activeChatId, { chatModel: model === 'auto' ? null : model }).catch(() => {
                toast.error(t('chatModelSaveFailed'))
            })
        }
    }, [activeChatId, selectedModel, setChatModel, setSelectedModel])

    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const docInputRef = React.useRef<HTMLInputElement>(null)
    const folderInputRef = React.useRef<HTMLInputElement>(null)
    const [pendingImages, setPendingImages] = React.useState<string[]>([])
    const [pendingDocs, setPendingDocs] = React.useState<PendingDocument[]>([])
    const [isUploading, setIsUploading] = React.useState(false)
    const [isStopPending, setIsStopPending] = React.useState(false)
    const [availableModels, setAvailableModels] = React.useState<string[]>([])
    const [slashDropdownIdx, setSlashDropdownIdx] = React.useState(-1)
    const stopRequestKeyRef = React.useRef<string | null>(null)

    const slashQuery = inputValue.startsWith('/') && !inputValue.includes(' ') ? inputValue.slice(1).toLowerCase() : null
    const filteredCmds = slashQuery !== null && slashCommands?.length
        ? slashCommands.filter((command) => slashQuery === '' || command.id.startsWith(slashQuery) || command.label.includes(slashQuery))
        : []
    const showSlashDropdown = filteredCmds.length > 0

    React.useEffect(() => {
        let disposed = false
        const loadAvailableModels = async () => {
            try {
                const res = await fetchPreferences()
                if (disposed) return
                const next = Array.isArray(res.availableModels)
                    ? res.availableModels.filter((model): model is string => typeof model === 'string').map((model) => model.trim()).filter((model) => Boolean(model) && model !== 'auto')
                    : []
                setAvailableModels([...new Set(next)])
            } catch {
                if (!disposed) setAvailableModels([])
            }
        }
        void loadAvailableModels()
        return () => { disposed = true }
    }, [])

    React.useEffect(() => {
        if (selectedModel === 'auto') return
        if (availableModels.length === 0) return
        if (!availableModels.includes(selectedModel)) {
            setSelectedModel('auto')
        }
    }, [availableModels, selectedModel, setSelectedModel])

    const currentStopKey = activeChatId ? (activeRunId ? `run:${activeRunId}` : `session:${activeChatId}`) : null

    React.useEffect(() => {
        if (!isGenerating || stopRequestKeyRef.current !== currentStopKey) {
            stopRequestKeyRef.current = null
            setIsStopPending(false)
        }
    }, [currentStopKey, isGenerating])

    const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (!files) return
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            if (file.size > 10 * 1024 * 1024) continue
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }
        event.target.value = ''
    }

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files
        if (!fileList) return
        const files = Array.from(fileList).filter((file) => file.size <= 20 * 1024 * 1024)
        if (files.length === 0) return
        setIsUploading(true)
        try {
            const results = await uploadFiles(files)
            for (const result of results) {
                if (result.type === 'image') {
                    setPendingImages((prev) => [...prev, result.dataUrl])
                } else if (result.type === 'document') {
                    setPendingDocs((prev) => [...prev, { filename: result.filename, text: result.text, pageCount: result.pageCount, mimeType: result.mimeType }])
                }
            }
        } catch (err) {
            console.error('File upload failed:', err)
        } finally {
            setIsUploading(false)
            event.target.value = ''
        }
    }

    const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files
        if (!fileList) return
        const files = Array.from(fileList).filter((file) => file.size <= 20 * 1024 * 1024)
        if (files.length === 0) return
        setIsUploading(true)
        try {
            const results = await uploadFiles(files)
            for (const result of results) {
                if (result.type === 'image') {
                    setPendingImages((prev) => [...prev, result.dataUrl])
                } else if (result.type === 'document') {
                    setPendingDocs((prev) => [...prev, { filename: result.filename, text: result.text, pageCount: result.pageCount, mimeType: result.mimeType }])
                }
            }
        } catch (err) {
            console.error('Folder upload failed:', err)
        } finally {
            setIsUploading(false)
            event.target.value = ''
        }
    }

    const removeImage = (idx: number) => setPendingImages((prev) => prev.filter((_, index) => index !== idx))
    const removeDoc = (idx: number) => setPendingDocs((prev) => prev.filter((_, index) => index !== idx))

    const handleSendRef = React.useRef<(overrideText?: string) => Promise<void>>(async () => {})

    const handleSend = async (overrideText?: string) => {
        const text = overrideText ?? inputValue.trim()
        if ((!text && !pendingImages.length && !pendingDocs.length) || !activeChatId || isGenerating) return
        const sid = activeChatId
        window.speechSynthesis?.cancel()
        const images = pendingImages.length ? [...pendingImages] : undefined
        const documents = pendingDocs.length ? [...pendingDocs] : undefined
        const fileAttachments: FileAttachment[] = [
            ...(documents?.map((document) => ({ filename: document.filename, type: 'document' as const, preview: document.text.slice(0, 200), pageCount: document.pageCount, mimeType: document.mimeType })) ?? []),
        ]

        addMessage(sid, {
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
        setIsGenerating(sid, true)
        setThinkingStatus(sid, t('thinking'))

        addMessage(sid, {
            id: Math.random().toString(36).substring(7),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        })

        const controller = new AbortController()
        setAbortController(sid, controller)
        let accumulated = ''
        let thinkingAccum = ''

        try {
            const activeChat = chats.find((chat) => chat.id === sid)
            const notebookId = activeChat?.mode === 'notebook' ? activeChat.notebookId : undefined
            const sourceIds = activeChat?.mode === 'notebook' ? activeChat.sourceIds : undefined
            for await (const chunk of streamChat(text, sid, controller.signal, selectedModel, images, documents?.map((document) => ({ filename: document.filename, text: document.text })), confirmDangerous, notebookId, sourceIds)) {
                if (chunk.type === 'run' && chunk.runId) {
                    setCurrentRunId(sid, chunk.runId)
                    continue
                }
                if (chunk.type === 'session') continue
                if (chunk.type === 'citations' && chunk.citations) {
                    setLastAssistantCitations(sid, chunk.citations)
                    continue
                }
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'thought') {
                    thinkingAccum += chunk.text ?? ''
                    updateLastAssistantThinking(sid, thinkingAccum)
                } else if (chunk.type === 'tool_call') {
                    const toolLabel = toolDisplayName(chunk.toolName ?? 'tool')
                    const toolPreview = chunk.args ? semanticPreview({ type: 'tool_call', toolName: chunk.toolName ?? 'tool', args: chunk.args, timestamp: Date.now() }, 50) : ''
                    setThinkingStatus(sid, toolPreview ? `${toolLabel}  ${toolPreview}` : toolLabel)
                    appendToLastAssistantActivity(sid, { type: 'tool_call', toolName: chunk.toolName ?? 'tool', args: chunk.args, timestamp: Date.now() })
                } else if (chunk.type === 'tool_result') {
                    appendToLastAssistantActivity(sid, { type: 'tool_result', toolName: chunk.toolName ?? 'tool', result: chunk.result, resultId: chunk.resultId, truncated: chunk.truncated, timestamp: Date.now() })
                } else if (chunk.type === 'tool_confirm' && chunk.confirmId) {
                    appendToLastAssistantActivity(sid, { type: 'tool_confirm', toolName: chunk.toolName ?? 'tool', args: chunk.args, confirmId: chunk.confirmId, runId: chunk.runId, actionId: chunk.actionId, confirmStatus: 'pending', timestamp: Date.now() })
                } else if (chunk.type === 'confirm_resolved' && chunk.confirmId && chunk.confirmStatus) {
                    updateActivityConfirmStatus(sid, chunk.confirmId, chunk.confirmStatus, chunk.approvalScope)
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus(sid, '')
                    accumulated += chunk.text
                    updateLastAssistantMessage(sid, accumulated)
                } else if (chunk.type === 'image' && chunk.url) {
                    setThinkingStatus(sid, '')
                    addImageToLastAssistantMessage(sid, chunk.url)
                } else if (chunk.type === 'video' && chunk.url) {
                    setThinkingStatus(sid, '')
                    addVideoToLastAssistantMessage(sid, chunk.url)
                } else if (chunk.type === 'todo_update' && chunk.todos) {
                    updateLastAssistantTodos(sid, chunk.todos as AgentTodoItem[])
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(sid, `⚠️ ${err instanceof Error ? err.message : t('requestFailed')}`)
            }
        } finally {
            if (thinkingAccum) updateLastAssistantThinking(sid, thinkingAccum)
            setIsGenerating(sid, false)
            setCurrentRunId(sid, null)
            setThinkingStatus(sid, '')
            setAbortController(sid, null)
        }
    }

    const handleStop = async () => {
        if (!activeChatId) return
        const sid = activeChatId
        const runId = useAppStore.getState().currentRunIdBySession[sid]
        const stopKey = runId ? `run:${runId}` : `session:${sid}`
        if (stopRequestKeyRef.current === stopKey) return
        stopRequestKeyRef.current = stopKey
        setIsStopPending(true)
        if (runId) {
            try {
                await cancelRun(runId)
                return
            } catch {
            }
        }
        const controller = useAppStore.getState().abortControllerBySession[sid]
        if (controller) {
            controller.abort()
            return
        }
        stopRequestKeyRef.current = null
        setIsStopPending(false)
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (showSlashDropdown) {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSlashDropdownIdx((index) => Math.min(index + 1, filteredCmds.length - 1))
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSlashDropdownIdx((index) => Math.max(index - 1, 0))
                return
            }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                const index = slashDropdownIdx >= 0 ? slashDropdownIdx : 0
                const cmd = filteredCmds[index]
                if (cmd) {
                    setInputValue('')
                    setSlashDropdownIdx(-1)
                    onSlashCommand?.(cmd.id)
                }
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                setInputValue('')
                setSlashDropdownIdx(-1)
                return
            }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            handleSend()
        }
        if (event.key === 'Escape' && isGenerating) {
            event.preventDefault()
            handleStop()
        }
    }

    const handlePaste = async (event: React.ClipboardEvent) => {
        const items = event.clipboardData.items
        const imageFiles: File[] = []
        const docFiles: File[] = []

        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                event.preventDefault()
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
            } else if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file && !file.type.startsWith('image/')) {
                    event.preventDefault()
                    docFiles.push(file)
                }
            }
        }

        for (const file of imageFiles) {
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }

        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const result of results) {
                    if (result.type === 'image') {
                        setPendingImages((prev) => [...prev, result.dataUrl])
                    } else if (result.type === 'document') {
                        setPendingDocs((prev) => [...prev, { filename: result.filename, text: result.text, pageCount: result.pageCount, mimeType: result.mimeType }])
                    }
                }
            } catch (err) {
                console.error('Paste file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
        }
    }

    const [attachMenuOpen, setAttachMenuOpen] = React.useState(false)
    const attachMenuRef = React.useRef<HTMLDivElement>(null)
    const attachButtonRef = React.useRef<HTMLButtonElement>(null)
    const [attachMenuStyle, setAttachMenuStyle] = React.useState<React.CSSProperties>({})
    React.useLayoutEffect(() => {
        if (!attachMenuOpen) return
        const rect = attachButtonRef.current?.getBoundingClientRect()
        if (!rect) return
        setAttachMenuStyle({ position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + 6, width: 160 })
    }, [attachMenuOpen])
    React.useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const target = event.target as Node
            if (attachMenuRef.current?.contains(target) || attachButtonRef.current?.contains(target)) return
            setAttachMenuOpen(false)
        }
        if (attachMenuOpen) document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [attachMenuOpen])

    const [isDragOver, setIsDragOver] = React.useState(false)
    const handleDragOver = (event: React.DragEvent) => { event.preventDefault(); setIsDragOver(true) }
    const handleDragLeave = (event: React.DragEvent) => { event.preventDefault(); setIsDragOver(false) }
    const handleDrop = async (event: React.DragEvent) => {
        event.preventDefault()
        setIsDragOver(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length === 0) return
        const imageFiles = files.filter((file) => file.type.startsWith('image/'))
        const docFiles = files.filter((file) => !file.type.startsWith('image/'))
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
        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const result of results) {
                    if (result.type === 'image') {
                        setPendingImages((prev) => [...prev, result.dataUrl])
                    } else if (result.type === 'document') {
                        setPendingDocs((prev) => [...prev, { filename: result.filename, text: result.text, pageCount: result.pageCount, mimeType: result.mimeType }])
                    }
                }
            } catch (err) {
                console.error('Drop file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
        }
    }

    type VoiceState = 'idle' | 'recording' | 'transcribing'
    const [voiceState, setVoiceState] = React.useState<VoiceState>('idle')
    const [voiceError, setVoiceError] = React.useState<string | null>(null)
    const [recordingSeconds, setRecordingSeconds] = React.useState(0)
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
    const audioChunksRef = React.useRef<Blob[]>([])
    const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
    const MAX_RECORDING_SECONDS = 90
    const stopRecordingTimer = () => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
    }

    const cancelRecording = React.useCallback(() => {
        stopRecordingTimer()
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
            mediaRecorderRef.current.stop()
        }
        mediaRecorderRef.current = null
        audioChunksRef.current = []
        setVoiceState('idle')
        setRecordingSeconds(0)
        setVoiceError(null)
    }, [])

    React.useEffect(() => () => cancelRecording(), [cancelRecording])

    const handleVoiceClick = async () => {
        if (voiceState === 'recording') {
            stopRecordingTimer()
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop()
            }
            return
        }
        if (voiceState === 'transcribing') return
        setVoiceError(null)
        if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setVoiceError(t('voiceErrorNoSupport'))
            return
        }
        if (!window.isSecureContext) {
            setVoiceError(t('voiceErrorInsecure'))
            return
        }
        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('not allowed')) {
                setVoiceError(t('voiceErrorPermission'))
            } else {
                setVoiceError(t('voiceErrorNoSupport'))
            }
            return
        }

        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? ''
        audioChunksRef.current = []
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        mediaRecorderRef.current = recorder
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunksRef.current.push(event.data)
        }
        recorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop())
            const chunks = audioChunksRef.current
            audioChunksRef.current = []
            mediaRecorderRef.current = null
            setRecordingSeconds(0)
            if (chunks.length === 0) {
                setVoiceState('idle')
                return
            }
            setVoiceState('transcribing')
            const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
            const ext = (mimeType || 'audio/webm').split('/')[1]?.split(';')[0] ?? 'webm'
            try {
                const text = await transcribeAudio(blob, `recording.${ext}`)
                const current = useAppStore.getState().inputValue
                setInputValue(current ? `${current} ${text}` : text)
                setVoiceState('idle')
                setTimeout(() => textareaRef.current?.focus(), 50)
            } catch (err) {
                const msg = err instanceof Error ? err.message : ''
                if (msg.toLowerCase().includes('no transcription provider') || msg.toLowerCase().includes('api key')) {
                    setVoiceError(t('voiceErrorNoProvider'))
                } else {
                    setVoiceError(t('voiceErrorGeneric'))
                }
                setVoiceState('idle')
            }
        }

        recorder.start(250)
        setVoiceState('recording')
        setRecordingSeconds(0)
        recordingTimerRef.current = setInterval(() => {
            setRecordingSeconds((seconds) => {
                const next = seconds + 1
                if (next >= MAX_RECORDING_SECONDS) {
                    stopRecordingTimer()
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                        mediaRecorderRef.current.stop()
                    }
                }
                return next
            })
        }, 1000)
    }

    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
        }
    }, [inputValue])

    React.useEffect(() => {
        if (activeChatId && textareaRef.current) {
            textareaRef.current.focus()
        }
    }, [activeChatId])

    React.useLayoutEffect(() => { handleSendRef.current = handleSend })
    React.useEffect(() => {
        if (!pendingQuickReply || isGenerating || !activeChatId) return
        const text = pendingQuickReply
        setPendingQuickReply(null)
        void handleSendRef.current(text)
    }, [activeChatId, isGenerating, pendingQuickReply, setPendingQuickReply])

    return (
        <div className="safe-bottom shrink-0 border-t border-border bg-bg-container/80 p-3 backdrop-blur-xl sm:p-4">
            <div className="relative mx-auto max-w-3xl min-w-0">
                {(pendingImages.length > 0 || pendingDocs.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {pendingImages.map((src, index) => (
                            <div key={`img-${index}`} className="group relative">
                                <img src={src} alt="" className="h-16 w-16 rounded-xl border border-border object-cover" />
                                <button onClick={() => removeImage(index)} className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-text text-bg-container opacity-0 transition-opacity group-hover:opacity-100">
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {pendingDocs.map((doc, index) => (
                            <div key={`doc-${index}`} className="group relative flex items-center gap-2 rounded-xl border border-border bg-fill-secondary/60 px-3 py-2 text-xs">
                                <FileAttachmentIcon filename={doc.filename} />
                                <span className="max-w-[120px] truncate text-text-secondary">{doc.filename}</span>
                                {doc.pageCount && <span className="text-text-quaternary">({doc.pageCount}p)</span>}
                                <button onClick={() => removeDoc(index)} className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-text text-bg-container opacity-0 transition-opacity group-hover:opacity-100">
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {isUploading && (
                            <div className="flex items-center gap-2 rounded-xl border border-border bg-fill-secondary/60 px-3 py-2 text-xs text-text-tertiary">
                                <Loader2 size={14} className="animate-spin" />
                                <span>{t('uploading')}</span>
                            </div>
                        )}
                    </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                <input ref={docInputRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.json,.csv,.xml,.yaml,.yml,.log,.html,.htm,.js,.ts,.py,.sh,.css,.sql" multiple className="hidden" onChange={handleFileSelect} />
                <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-expect-error webkitdirectory is not in standard types
                    webkitdirectory=""
                    multiple
                    className="hidden"
                    onChange={handleFolderSelect}
                />
                {showSlashDropdown && (
                    <div className="absolute bottom-full right-0 left-0 z-50 mb-1.5">
                        <div className="mx-2 overflow-hidden rounded-xl border border-border bg-bg-container shadow-lg">
                            {filteredCmds.map((cmd, index) => (
                                <button
                                    key={cmd.id}
                                    onMouseDown={(event) => {
                                        event.preventDefault()
                                        setInputValue('')
                                        setSlashDropdownIdx(-1)
                                        onSlashCommand?.(cmd.id)
                                    }}
                                    className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors', index === slashDropdownIdx ? 'bg-primary-mint/10 text-primary-mint' : 'text-text hover:bg-fill-secondary/60')}
                                >
                                    {cmd.icon && <cmd.icon size={14} className="shrink-0 text-text-tertiary" />}
                                    <span className="shrink-0 font-medium">/{cmd.id}</span>
                                    {cmd.description && <span className="truncate text-xs text-text-tertiary">{cmd.description}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <div
                    className={cn('relative rounded-2xl border bg-fill-secondary/80 transition-all duration-200 focus-within:border-primary-mint/40 focus-within:ring-2 focus-within:ring-primary-mint/30', isDragOver ? 'border-dashed border-primary-mint bg-primary-mint/5' : 'border-border')}
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(event) => { setInputValue(event.target.value); setSlashDropdownIdx(-1) }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={t('askAnything')}
                        className="w-full resize-none bg-transparent px-5 pt-3.5 pb-2 pr-14 text-sm leading-relaxed placeholder:text-text-tertiary focus:outline-none"
                        rows={1}
                    />
                    <div className="flex min-w-0 items-center justify-between gap-2 px-3 pb-2.5">
                        <div className="mobile-scroll-x flex min-w-0 flex-1 items-center gap-1">
                            <div className="relative shrink-0">
                                <button ref={attachButtonRef} onClick={() => setAttachMenuOpen((value) => !value)} className={cn('cursor-pointer rounded-lg p-1.5 transition-all duration-150', attachMenuOpen ? 'bg-fill text-text-secondary' : 'text-text-tertiary hover:bg-fill hover:text-text-secondary')} title={t('addAttachment')} type="button">
                                    <Plus size={16} />
                                </button>
                            </div>
                            {attachMenuOpen && typeof document !== 'undefined' && createPortal(
                                <div ref={attachMenuRef} className="z-[120] overflow-hidden rounded-xl border border-border bg-bg-container py-1 shadow-lg" style={attachMenuStyle}>
                                    <button onClick={() => { fileInputRef.current?.click(); setAttachMenuOpen(false) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text transition-colors hover:bg-fill-secondary/60" type="button">
                                        <ImagePlus size={14} className="shrink-0 text-text-tertiary" />
                                        <span>{t('attachImage')}</span>
                                    </button>
                                    <button onClick={() => { docInputRef.current?.click(); setAttachMenuOpen(false) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text transition-colors hover:bg-fill-secondary/60" type="button" disabled={isUploading}>
                                        <Paperclip size={14} className="shrink-0 text-text-tertiary" />
                                        <span>{t('attachDocument')}</span>
                                    </button>
                                    <button onClick={() => { folderInputRef.current?.click(); setAttachMenuOpen(false) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-text transition-colors hover:bg-fill-secondary/60" type="button" disabled={isUploading}>
                                        <FolderOpen size={14} className="shrink-0 text-text-tertiary" />
                                        <span>{t('attachFolder')}</span>
                                    </button>
                                </div>,
                                document.body,
                            )}
                            {activeChatId && <ProjectPicker sessionId={activeChatId} projectRoot={chats.find((chat) => chat.id === activeChatId)?.projectRoot ?? null} />}
                            <ModelPicker selectedModel={selectedModel} onSelect={handleModelSelect} availableModels={availableModels} />
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                            {isGenerating && <span className="hidden text-[11px] text-text-tertiary sm:inline">{t('pressEscToStop')}</span>}
                            {!isGenerating && (
                                <button type="button" onClick={() => void handleVoiceClick()} disabled={voiceState === 'transcribing'} className={cn('cursor-pointer rounded-xl p-2 transition-all duration-200', voiceState === 'recording' ? 'animate-pulse bg-destructive/10 text-destructive hover:bg-destructive/20' : voiceState === 'transcribing' ? 'cursor-wait bg-fill text-text-tertiary' : 'text-text-tertiary hover:bg-fill hover:text-text-secondary')} title={voiceState === 'recording' ? t('voiceStop') : voiceState === 'transcribing' ? t('voiceTranscribing') : t('voiceInput')} aria-label={voiceState === 'recording' ? t('voiceStop') : t('voiceInput')}>
                                    {voiceState === 'transcribing' ? <Loader2 size={14} className="animate-spin" /> : voiceState === 'recording' ? <MicOff size={14} /> : <Mic size={14} />}
                                </button>
                            )}
                            {isGenerating ? (
                                <button onClick={handleStop} disabled={isStopPending} className={cn('rounded-xl bg-text p-2 text-bg-container transition-all duration-200', isStopPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:scale-105 hover:opacity-80 active:scale-95')} title={t('stopEsc')}>
                                    {isStopPending ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} fill="currentColor" />}
                                </button>
                            ) : (
                                <button onClick={() => handleSend()} disabled={!inputValue.trim() && !pendingImages.length && !pendingDocs.length} className={cn('rounded-xl p-2 transition-all duration-200', !inputValue.trim() && !pendingImages.length && !pendingDocs.length ? 'cursor-not-allowed bg-fill text-text-tertiary' : 'cursor-pointer bg-gradient-to-r from-primary-mint to-emerald-500 text-white shadow-sm hover:scale-105 hover:opacity-90 active:scale-95')} title={t('sendEnter')}>
                                    <Send size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                    {(voiceState === 'recording' || voiceState === 'transcribing' || voiceError) && (
                        <div className={cn('mx-0 flex items-center gap-2 rounded-b-2xl px-3 py-1.5 text-xs', voiceError ? 'bg-destructive/8 text-destructive' : 'bg-primary-mint/8 text-primary-mint')}>
                            {voiceError ? (
                                <>
                                    <span className="flex-1">{voiceError}</span>
                                    <button type="button" onClick={() => setVoiceError(null)} className="shrink-0 rounded p-0.5 transition-colors hover:bg-destructive/10" aria-label={t('cancel')}>
                                        <X size={12} />
                                    </button>
                                </>
                            ) : voiceState === 'recording' ? (
                                <>
                                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
                                    <span className="flex-1">{t('voiceRecording')}</span>
                                    <span className="shrink-0 tabular-nums">{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span>
                                    <button type="button" onClick={cancelRecording} className="ml-1 shrink-0 rounded p-0.5 transition-colors hover:bg-primary-mint/10" aria-label={t('voiceCancel')} title={t('voiceCancel')}>
                                        <X size={12} />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Loader2 size={12} className="shrink-0 animate-spin" />
                                    <span>{t('voiceTranscribing')}</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1">
                    <button onClick={() => setConfirmDangerous(!confirmDangerous)} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] transition-all duration-150', confirmDangerous ? 'bg-primary-mint/10 text-primary-mint hover:bg-primary-mint/20' : 'text-text-tertiary hover:bg-fill hover:text-text-secondary')} title={confirmDangerous ? t('safeConfirmTitleOn') : t('safeConfirmTitleOff')} type="button">
                        {confirmDangerous ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                        <span className="ml-0.5">{confirmDangerous ? t('safeConfirmOn') : t('safeConfirmOff')}</span>
                    </button>
                    <button onClick={onOpenToolApprovals} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-text-tertiary transition-all duration-150 hover:bg-fill hover:text-text-secondary" type="button">
                        {t('manageToolApprovals')}
                    </button>
                    <span className="ml-auto hidden select-none items-center gap-1 text-[10px] text-text-quaternary sm:flex">
                        <kbd className="rounded border border-border-secondary bg-fill px-1 py-0.5 text-[10px]">Enter</kbd> {t('enterToSend')} · <kbd className="rounded border border-border-secondary bg-fill px-1 py-0.5 text-[10px]">Shift+Enter</kbd> {t('shiftEnterNewline')} · <kbd className="rounded border border-border-secondary bg-fill px-1 py-0.5 text-[10px]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+N</kbd> {t('newChatShortcut')}
                    </span>
                </div>
            </div>
        </div>
    )
}
