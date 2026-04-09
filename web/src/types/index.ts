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
    thinking?: string   // model's internal reasoning (thinking tokens)
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

export type TodoStatus = 'not-started' | 'completed'

export interface TodoItem {
    id: string
    content: string
    status: TodoStatus
    priority: string | null
    remind_at: string | null
    created_at: string
    updated_at: string
}

export interface TodoAnalysis {
    content: string
    remind_at: string | null
    priority: string | null
}

export interface InboxNote {
    id: number
    content: string
    date: string
    time: string
    created_at: number
    tags: string | null    // JSON stringified string[] or null
}

export interface NoteHeatmapDay {
    date: string
    count: number
}

export interface NoteTag {
    tag: string
    count: number
}

// ── Cron ─────────────────────────────────────────────────────────────────────

export interface CronJobInfo {
    name: string
    schedule: string
    description: string | null
    enabled: number          // 0 | 1
    updated_at: number
    last_status: string | null
    last_started_at: number | null
    last_finished_at: number | null
    last_duration_ms: number | null
    last_error: string | null
    last_summary: string | null
}

export interface CronRunInfo {
    id: number
    job_name: string
    status: string           // 'running' | 'success' | 'error'
    started_at: number
    finished_at: number | null
    duration_ms: number | null
    error: string | null
    summary: string | null
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
    updateLastAssistantThinking: (chatId: string, thinking: string) => void

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
