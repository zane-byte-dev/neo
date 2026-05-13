import type { StateCreator } from 'zustand'
import type { ActivityItem, AgentTodoItem, AppState, ApprovalScope, Chat, Message, MessagePart, NoteEntry, ParsedCitation } from '../../types'
import { deriveChatTitleFromMessage } from '../../chat-title'
import { t } from '../../i18n'
import { openNotebookSession, patchSession } from '../../api'

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
    archiveChat: (id: string, archived: boolean) => void
    renameChat: (id: string, title: string) => void
    setChatModel: (id: string, model: string) => void

    // Messages
    messages: Record<string, Message[]>
    addMessage: (sessionId: string, message: Message) => void
    setMessages: (sessionId: string, messages: Message[]) => void
    updateLastAssistantMessage: (sessionId: string, content: string) => void
    addImageToLastAssistantMessage: (sessionId: string, dataUrl: string) => void
    addVideoToLastAssistantMessage: (sessionId: string, url: string) => void
    updateLastAssistantThinking: (sessionId: string, thinking: string) => void
    updateLastAssistantTodos: (sessionId: string, todos: AgentTodoItem[]) => void
    setLastAssistantCitations: (sessionId: string, citations: ParsedCitation[]) => void
    /** Find or create the chat session bound to a notebook. Returns the chat id. */
    openOrCreateNotebookChat: (notebookId: string, sourceIds?: string[]) => Promise<string>
    /** Update sourceIds for a chat (notebook mode) and persist to server. */
    setChatSourceIds: (chatId: string, sourceIds: string[]) => Promise<void>
    appendToLastAssistantActivity: (sessionId: string, item: ActivityItem) => void
    updateActivityConfirmStatus: (sessionId: string, confirmId: string, status: NonNullable<ActivityItem['confirmStatus']>, approvalScope?: ApprovalScope) => void

    // Input
    inputValue: string
    setInputValue: (value: string) => void
    pendingQuickReply: string | null
    setPendingQuickReply: (text: string | null) => void
    // Per-session generation state (keyed by sessionId so multiple chats can stream concurrently)
    generatingBySession: Record<string, boolean>
    setIsGenerating: (sessionId: string, v: boolean) => void
    currentRunIdBySession: Record<string, string | null>
    setCurrentRunId: (sessionId: string, runId: string | null) => void
    abortControllerBySession: Record<string, AbortController | null>
    setAbortController: (sessionId: string, c: AbortController | null) => void
    thinkingStatusBySession: Record<string, string>
    setThinkingStatus: (sessionId: string, s: string) => void
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
        const now = Date.now()
        const newChat: Chat = {
            id: Math.random().toString(36).substring(7),
            title: t('newChat'),
            isPinned: false,
            createdAt: now,
            updatedAt: now,
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
        const now = Date.now()
        const newChat: Chat = {
            id,
            title: title ?? id,
            isPinned: false,
            createdAt: now,
            updatedAt: now,
        }
        return { chats: [newChat, ...state.chats], activeChatId: id, selectedNote: null }
    }),
    deleteChat: (id: string) => set((state) => {
        const newChats = state.chats.filter((c) => c.id !== id)
        // Abort any in-flight stream for the deleted chat and clear its per-session state.
        try { state.abortControllerBySession[id]?.abort() } catch { /* ignore */ }
        const generatingBySession = { ...state.generatingBySession }; delete generatingBySession[id]
        const currentRunIdBySession = { ...state.currentRunIdBySession }; delete currentRunIdBySession[id]
        const abortControllerBySession = { ...state.abortControllerBySession }; delete abortControllerBySession[id]
        const thinkingStatusBySession = { ...state.thinkingStatusBySession }; delete thinkingStatusBySession[id]
        const messages = { ...state.messages }; delete messages[id]
        return {
            chats: newChats,
            activeChatId: state.activeChatId === id ? (newChats[0]?.id ?? null) : state.activeChatId,
            generatingBySession,
            currentRunIdBySession,
            abortControllerBySession,
            thinkingStatusBySession,
            messages,
        }
    }),
    pinChat: (id: string) => set((state) => {
        const updated = state.chats.map((c) =>
            c.id === id ? { ...c, isPinned: !c.isPinned } : c
        )
        return { chats: updated }
    }),
    archiveChat: (id: string, archived: boolean) => set((state) => ({
        chats: state.chats.map((c) => c.id === id ? { ...c, isArchived: archived } : c),
    })),
    renameChat: (id: string, title: string) => set((state) => ({
        chats: state.chats.map((c) => c.id === id ? { ...c, title } : c),
    })),
    setChatModel: (id: string, model: string) => set((state) => ({
        chats: state.chats.map((c) => c.id === id ? { ...c, chatModel: model } : c),
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
            c.id === sessionId
                ? {
                    ...c,
                    updatedAt: message.timestamp ?? Date.now(),
                    title: (c.title === 'New Chat' || c.title === '新对话') && message.role === 'user'
                        ? deriveChatTitleFromMessage(
                            message.content || '',
                            (message.images?.length ? '📷 Image' : '') || (message.files?.length ? `📎 ${message.files[0].filename}` : ''),
                        )
                        : c.title,
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
    setLastAssistantCitations: (sessionId: string, citations: ParsedCitation[]) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], citations }
                break
            }
        }
        return { messages: { ...state.messages, [sessionId]: msgs } }
    }),
    openOrCreateNotebookChat: async (notebookId: string, sourceIds?: string[]) => {
        const session = await openNotebookSession(notebookId, sourceIds)
        const incoming: Chat = {
            id: session.id,
            title: session.title,
            isPinned: session.isPinned,
            isArchived: session.isArchived ?? false,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt ?? session.createdAt,
            projectRoot: session.projectRoot ?? null,
            mode: 'notebook',
            notebookId: session.notebookId,
            ...(session.sourceIds ? { sourceIds: session.sourceIds } : {}),
        }
        set((state) => {
            const exists = state.chats.some((c) => c.id === incoming.id)
            const chats = exists
                ? state.chats.map((c) => c.id === incoming.id ? { ...c, ...incoming } : c)
                : [incoming, ...state.chats]
            return { chats, activeChatId: incoming.id }
        })
        return incoming.id
    },
    setChatSourceIds: async (chatId: string, sourceIds: string[]) => {
        await patchSession(chatId, { sourceIds })
        set((state) => ({
            chats: state.chats.map((c) => c.id === chatId ? { ...c, sourceIds } : c),
        }))
    },
    appendToLastAssistantActivity: (sessionId: string, item: ActivityItem) => set((state) => {
        const msgs = [...(state.messages[sessionId] ?? [])]
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
                const currentLog = [...(msgs[i].activityLog ?? [])]
                const currentParts = [...(msgs[i].parts ?? [])]
                if (item.type === 'tool_confirm' && item.confirmId) {
                    const existingIdx = currentLog.findIndex(
                        (entry) => entry.type === 'tool_confirm' && entry.confirmId === item.confirmId,
                    )
                    if (existingIdx >= 0) {
                        const existing = currentLog[existingIdx]
                        const confirmStatus = existing.confirmStatus && existing.confirmStatus !== 'pending'
                            ? existing.confirmStatus
                            : item.confirmStatus ?? existing.confirmStatus
                        const nextItem: ActivityItem = {
                            ...existing,
                            ...item,
                            ...(confirmStatus ? { confirmStatus } : {}),
                            ...(item.approvalScope !== undefined
                                ? { approvalScope: item.approvalScope }
                                : existing.approvalScope !== undefined
                                    ? { approvalScope: existing.approvalScope }
                                    : {}),
                            timestamp: existing.timestamp,
                        }
                        currentLog[existingIdx] = nextItem
                        msgs[i] = {
                            ...msgs[i],
                            activityLog: currentLog,
                            parts: currentParts.map((part) => {
                                if (part.type !== 'activity') return part
                                if (part.item.type !== 'tool_confirm' || part.item.confirmId !== item.confirmId) return part
                                return { type: 'activity', item: nextItem }
                            }),
                        }
                        break
                    }
                }
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
    generatingBySession: {},
    setIsGenerating: (sessionId: string, v: boolean) => set((state) => {
        const next = { ...state.generatingBySession }
        if (v) next[sessionId] = true
        else delete next[sessionId]
        return { generatingBySession: next }
    }),
    currentRunIdBySession: {},
    setCurrentRunId: (sessionId: string, runId: string | null) => set((state) => {
        const next = { ...state.currentRunIdBySession }
        if (runId) next[sessionId] = runId
        else delete next[sessionId]
        return { currentRunIdBySession: next }
    }),
    abortControllerBySession: {},
    setAbortController: (sessionId: string, c: AbortController | null) => set((state) => {
        const next = { ...state.abortControllerBySession }
        if (c) next[sessionId] = c
        else delete next[sessionId]
        return { abortControllerBySession: next }
    }),
    thinkingStatusBySession: {},
    setThinkingStatus: (sessionId: string, s: string) => set((state) => {
        const next = { ...state.thinkingStatusBySession }
        if (s) next[sessionId] = s
        else delete next[sessionId]
        return { thinkingStatusBySession: next }
    }),
    selectedModel: 'auto',
    setSelectedModel: (model: string) => set({ selectedModel: model }),

    // Legacy notebook list
    notebookEntries: [],
    setNotebookEntries: (entries: NoteEntry[]) => set({ notebookEntries: entries }),
    selectedNote: null,
    setSelectedNote: (note: NoteEntry | null) => set({ selectedNote: note }),
})
