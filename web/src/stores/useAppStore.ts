import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActivityItem, AgentTodoItem, AppState, Chat, Message, NoteEntry, Theme } from '../types'

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // Theme
            theme: 'light' as Theme,
            setTheme: (theme: Theme) => {
                document.documentElement.setAttribute('data-theme', theme)
                set({ theme })
            },

            // Chat
            chats: [],
            activeChatId: null,
            setChats: (chats: Chat[]) => set({ chats }),
            createChat: () => {
                const newChat: Chat = {
                    id: Math.random().toString(36).substring(7),
                    title: 'New Chat',
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
                // Auto-title from first user message
                chats: state.chats.map((c) =>
                    c.id === sessionId && c.title === 'New Chat' && message.role === 'user'
                        ? { ...c, title: message.content.slice(0, 40) }
                        : c
                ),
            })),
            updateLastAssistantMessage: (sessionId: string, content: string) => set((state) => {
                const msgs = [...(state.messages[sessionId] ?? [])]
                for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].role === 'assistant') {
                        msgs[i] = { ...msgs[i], content }
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
                        msgs[i] = { ...msgs[i], activityLog: [...(msgs[i].activityLog ?? []), item] }
                        break
                    }
                }
                return { messages: { ...state.messages, [sessionId]: msgs } }
            }),

            // Input
            inputValue: '',
            setInputValue: (value: string) => set({ inputValue: value }),
            isGenerating: false,
            setIsGenerating: (v: boolean) => set({ isGenerating: v }),
            abortController: null,
            setAbortController: (c: AbortController | null) => set({ abortController: c }),
            thinkingStatus: '',
            setThinkingStatus: (s: string) => set({ thinkingStatus: s }),
            selectedModel: 'flash',
            setSelectedModel: (model: string) => set({ selectedModel: model }),

            // Notebook
            notebookEntries: [],
            setNotebookEntries: (entries: NoteEntry[]) => set({ notebookEntries: entries }),
            selectedNote: null,
            setSelectedNote: (note: NoteEntry | null) => set({ selectedNote: note, activeChatId: note ? null : null }),
        }),
        {
            name: 'neo-web-store',
            // Persist chats + messages + theme, not UI state
            partialize: (state) => ({
                theme: state.theme,
                selectedModel: state.selectedModel,
            }),
        }
    )
)
