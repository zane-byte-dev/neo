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
    deleteChat: (id: string) => void
    pinChat: (id: string) => void

    // Messages
    messages: Record<string, Message[]>
    addMessage: (chatId: string, message: Message) => void
    updateLastAssistantMessage: (chatId: string, content: string) => void

    // Input
    inputValue: string
    setInputValue: (value: string) => void
    isGenerating: boolean
    setIsGenerating: (v: boolean) => void
    abortController: AbortController | null
    setAbortController: (c: AbortController | null) => void

    // Notebook
    notebookEntries: NoteEntry[]
    setNotebookEntries: (entries: NoteEntry[]) => void
    selectedNote: NoteEntry | null
    setSelectedNote: (note: NoteEntry | null) => void
}
