import type { StateCreator } from 'zustand'
import type { ActivityItem, AgentTodoItem, AppState, ApprovalScope, Chat, Message, MessagePart, NoteEntry } from '../../types'
import { deriveChatTitleFromMessage } from '../../chat-title'
import { t } from '../../i18n'

function appendTextToParts(parts: MessagePart[] | undefined, content: string): MessagePart[] | undefined {
    if (!content) return parts
    const next = [...(parts ?? [])]
    const currentTextLength = next.reduce((sum, part) => part.type === 'text' ? sum + part.content.length : sum, 0)
    if (content.length < currentTextLength) {
        return [{ type: 'text', content }]
    }
    const delta = content.slice(currentTextLength)
    if (!delta) return next.length > 0 ? next : undefined
    const last = next[next.length - 1]
    if (last?.type === 'text') {
        next[next.length - 1] = { type: 'text', content: last.content + delta }
    } else {
        next.push({ type: 'text', content: delta })
    }
    return next
}

function updateConfirmInParts(
    parts: MessagePart[] | undefined,
    confirmId: string,
    status: NonNullable<ActivityItem['confirmStatus']>,
    approvalScope?: ApprovalScope,
): MessagePart[] | undefined {
    if (!parts?.length) return parts
    return parts.map((part) => {
        if (part.type !== 'activity') return part
        if (part.item.type !== 'tool_confirm' || part.item.confirmId !== confirmId) return part
        return {
            type: 'activity',
            item: {
                ...part.item,
                confirmStatus: status,
                ...(approvalScope !== undefined ? { approvalScope } : {}),
            },
        }
    })
}

function sameArgs(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

export interface ChatSlice {
    // Chat
    chats: Chat[]
    activeChatId: string | null
    setChats: (chats: Chat[]) => void
    createChat: () => void
    selectChat: (id: string) => void
    selectOrCreateChat: (id: string, title?: string) => void
    deleteChat: (id: string) => void
    pinChat: (id: string) => void
    renameChat: (id: string, title: string) => void

    // Messages
    messages: Record<string, Message[]>
    addMessage: (sessionId: string, message: Message) => void
    setMessages: (sessionId: string, messages: Message[]) => void
    updateLastAssistantMessage: (sessionId: string, content: string) => void
    addImageToLastAssistantMessage: (sessionId: string, dataUrl: string) => void
    addVideoToLastAssistantMessage: (sessionId: string, url: string) => void
    updateLastAssistantThinking: (sessionId: string, thinking: string) => void
    updateLastAssistantTodos: (sessionId: string, todos: AgentTodoItem[]) => void
    appendToLastAssistantActivity: (sessionId: string, item: ActivityItem) => void
    updateActivityConfirmStatus: (sessionId: string, confirmId: string, status: NonNullable<ActivityItem['confirmStatus']>, approvalScope?: ApprovalScope) => void

    // Input
    inputValue: string
    setInputValue: (value: string) => void
    pendingQuickReply: string | null
    setPendingQuickReply: (text: string | null) => void
    isGenerating: boolean
    setIsGenerating: (v: boolean) => void
    currentRunId: string | null
    setCurrentRunId: (runId: string | null) => void
    abortController: AbortController | null
    setAbortController: (c: AbortController | null) => void
    thinkingStatus: string
    setThinkingStatus: (s: string) => void
    selectedModel: string
    setSelectedModel: (model: string) => void

    // Legacy notebook list
    notebookEntries: NoteEntry[]
    setNotebookEntries: (entries: NoteEntry[]) => void
    selectedNote: NoteEntry | null
    setSelectedNote: (note: NoteEntry | null) => void
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set) => ({
    // Chat
    chats: [],
    activeChatId: null,
    setChats: (chats: Chat[]) => set({ chats }),
    createChat: () => {
        const newChat: Chat = {
            id: Math.random().toString(36).substring(7),
            title: t('newChat'),
            isPinned: false,
            createdAt: Date.now(),
        }
        set((state) => ({
            chats: [newChat, ...state.chats],
            activeChatId: newChat.id,
            selectedNote: null,
        }))
    },
    selectChat: (id: string) => set({ activeChatId: id, selectedNote: null }),
    selectOrCreateChat: (id: string, title?: string) => set((state) => {
        const exists = state.chats.some((c) => c.id === id)
        if (exists) return { activeChatId: id, selectedNote: null }
        const newChat: Chat = {
            id,
            title: title ?? id,
            isPinned: false,
            createdAt: Date.now(),
        }
        return { chats: [newChat, ...state.chats], activeChatId: id, selectedNote: null }
    }),
    deleteChat: (id: string) => set((state) => {
        const newChats = state.chats.filter((c) => c.id !== id)
        return {
            chats: newChats,
            activeChatId: state.activeChatId === id ? (newChats[0]?.id ?? null) : state.activeChatId,
        }
    }),
    pinChat: (id: string) => set((state) => {
        const updated = state.chats.map((c) =>
            c.id === id ? { ...c, isPinned: !c.isPinned } : c
        )
        const pinned = updated.filter((c) => c.isPinned).sort((a, b) => b.createdAt - a.createdAt)
        const others = updated.filter((c) => !c.isPinned).sort((a, b) => b.createdAt - a.createdAt)
        return { chats: [...pinned, ...others] }
    }),
    renameChat: (id: string, title: string) => set((state) => ({
        chats: state.chats.map((c) => c.id === id ? { ...c, title } : c),
    })),

    // Messages
    messages: {},
    setMessages: (sessionId: string, msgs: Message[]) => set((state) => ({
        messages: { ...state.messages, [sessionId]: msgs },
    })),
    addMessage: (sessionId: string, message: Message) => set((state) => ({
        messages: {
            ...state.messages,
            [sessionId]: [...(state.messages[sessionId] ?? []), message],
        },
        chats: state.chats.map((c) =>
            c.id === sessionId && (c.title === 'New Chat' || c.title === '新对话') && message.role === 'user'
                ? {
                    ...c,
                    title: deriveChatTitleFromMessage(
                        message.content || '',
                        (message.images?.length ? '📷 Image' : '') || (message.files?.length ? `📎 ${message.files[0].filename}` : ''),
                    ),
                }
                : c
        ),
    })),
    updateLastAssistantMessage: (sessionId: string, content: string) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                const parts = appendTextToParts(msgs[i].parts, content)
                msgs[i] = { ...msgs[i], content, ...(parts ? { parts } : {}) }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    addImageToLastAssistantMessage: (sessionId: string, dataUrl: string) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], images: [...(msgs[i].images ?? []), dataUrl] }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    addVideoToLastAssistantMessage: (sessionId: string, url: string) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], videos: [...(msgs[i].videos ?? []), url] }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    updateLastAssistantThinking: (sessionId: string, thinking: string) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], thinking }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    updateLastAssistantTodos: (sessionId: string, todos: AgentTodoItem[]) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], todos }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    appendToLastAssistantActivity: (sessionId: string, item: ActivityItem) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                const currentLog = [...(msgs[i].activityLog ?? [])]
                const currentParts = [...(msgs[i].parts ?? [])]
                const lastLog = currentLog[currentLog.length - 1]
                const lastPart = currentParts[currentParts.length - 1]
                if (
                    item.type === 'tool_confirm'
                    && lastLog?.type === 'tool_call'
                    && lastLog.toolName === item.toolName
                    && sameArgs(lastLog.args, item.args)
                ) {
                    currentLog[currentLog.length - 1] = item
                    if (lastPart?.type === 'activity') {
                        currentParts[currentParts.length - 1] = { type: 'activity', item }
                    }
                    msgs[i] = {
                        ...msgs[i],
                        activityLog: currentLog,
                        parts: currentParts,
                    }
                    break
                }
                msgs[i] = {
                    ...msgs[i],
                    activityLog: [...currentLog, item],
                    parts: [...currentParts, { type: 'activity', item }],
                }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    updateActivityConfirmStatus: (sessionId, confirmId, status, approvalScope) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role !== 'assistant' || !m.activityLog) continue
            const idx = m.activityLog.findIndex((a) => a.type === 'tool_confirm' && a.confirmId === confirmId)
            if (idx < 0) continue
            const newLog = [...m.activityLog]
            newLog[idx] = {
                ...newLog[idx],
                confirmStatus: status,
                ...(approvalScope !== undefined ? { approvalScope } : {}),
            }
            const parts = updateConfirmInParts(m.parts, confirmId, status, approvalScope)
            msgs[i] = { ...m, activityLog: newLog, ...(parts ? { parts } : {}) }
            break
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),

    // Input
    inputValue: '',
    setInputValue: (value: string) => set({ inputValue: value }),
    pendingQuickReply: null,
    setPendingQuickReply: (text: string | null) => set({ pendingQuickReply: text }),
    isGenerating: false,
    setIsGenerating: (v: boolean) => set({ isGenerating: v }),
    currentRunId: null,
    setCurrentRunId: (runId: string | null) => set({ currentRunId: runId }),
    abortController: null,
    setAbortController: (c: AbortController | null) => set({ abortController: c }),
    thinkingStatus: '',
    setThinkingStatus: (s: string) => set({ thinkingStatus: s }),
    selectedModel: 'auto',
    setSelectedModel: (model: string) => set({ selectedModel: model }),

    // Legacy notebook list
    notebookEntries: [],
    setNotebookEntries: (entries: NoteEntry[]) => set({ notebookEntries: entries }),
    selectedNote: null,
    setSelectedNote: (note: NoteEntry | null) => set({ selectedNote: note, activeChatId: note ? null : null }),
})
