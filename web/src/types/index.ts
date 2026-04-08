export type Theme = 'light' | 'dark' | 'classic-dark'

export interface Chat {
    id: string
    title: string
    isPinned: boolean
    createdAt: number
}

export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    images?: string[]   // data URLs for AI-generated images
    timestamp: number
}

export interface NoteEntry {
    id: number
    title: string
    author: string | null
    date: string | null
    source: string | null
    summary: string | null
    tags: string | null
    content?: string
}

export type TodoStatus = 'not-started' | 'in-progress' | 'completed'

export interface TodoItem {
    id: string
    content: string
    status: TodoStatus
    priority: string | null
    created_at: string
    updated_at: string
}

export interface InboxNote {
    id: number
    content: string
    date: string
    time: string
    created_at: number
}

export interface AppState {
    // Auth
    token: string
    setToken: (token: string) => void

    // Theme
    theme: Theme
    setTheme: (theme: Theme) => void

    // Chat
    chats: Chat[]
    activeChatId: string | null
    createChat: () => void
    selectChat: (id: string) => void
    selectOrCreateChat: (id: string, title?: string) => void
    deleteChat: (id: string) => void
    pinChat: (id: string) => void

    // Messages
    messages: Record<string, Message[]>
    addMessage: (chatId: string, message: Message) => void
    updateLastAssistantMessage: (chatId: string, content: string) => void
    addImageToLastAssistantMessage: (chatId: string, dataUrl: string) => void

    // Input
    inputValue: string
    setInputValue: (value: string) => void
    isGenerating: boolean
    setIsGenerating: (v: boolean) => void
    abortController: AbortController | null
    setAbortController: (c: AbortController | null) => void
    thinkingStatus: string
    setThinkingStatus: (s: string) => void
    selectedModel: string
    setSelectedModel: (model: string) => void

    // Notebook
    notebookEntries: NoteEntry[]
    setNotebookEntries: (entries: NoteEntry[]) => void
    selectedNote: NoteEntry | null
    setSelectedNote: (note: NoteEntry | null) => void
}
