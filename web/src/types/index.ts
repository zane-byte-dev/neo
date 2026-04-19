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
    thinking?: string        // model's internal reasoning (thinking tokens)
    images?: string[]        // data URLs for AI-generated images
    videos?: string[]        // URLs for AI-generated videos
    files?: FileAttachment[] // attached documents (user uploads)
    todos?: AgentTodoItem[]  // agent task tracker
    activityLog?: ActivityItem[]  // real-time tool call log
    timestamp: number
}

export interface FileAttachment {
    filename: string
    type: 'image' | 'document'
    /** For documents: extracted text preview (first 200 chars) */
    preview?: string
    /** For documents: page/sheet count */
    pageCount?: number
    /** MIME type */
    mimeType?: string
}

export interface AgentTodoItem {
    id: number
    title: string
    status: 'not-started' | 'in-progress' | 'completed'
}

export interface ActivityItem {
    type: 'tool_call' | 'tool_result'
    toolName: string
    args?: Record<string, unknown>
    result?: string
    timestamp: number
}

export interface NoteEntry {
    id: string
    notebook?: string
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
    // Theme
    theme: Theme
    setTheme: (theme: Theme) => void

    // Locale
    locale: 'en' | 'zh'
    setLocale: (locale: 'en' | 'zh') => void

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

    // Auto speak
    autoSpeak: boolean
    setAutoSpeak: (v: boolean) => void

    // Notebook
    notebookEntries: NoteEntry[]
    setNotebookEntries: (entries: NoteEntry[]) => void
    selectedNote: NoteEntry | null
    setSelectedNote: (note: NoteEntry | null) => void

    // Notebook workspace (NotebookLM-style)
    activeNotebook: string | null
    setActiveNotebook: (name: string | null) => void
    sources: SourceMeta[]
    setSources: (sources: SourceMeta[]) => void
    selectedSourceIds: string[]
    setSelectedSourceIds: (ids: string[]) => void
    toggleSourceSelected: (id: string) => void
    sourceGuides: Record<string, SourceGuide>
    setSourceGuide: (id: string, guide: SourceGuide) => void
    notebookMessages: NotebookChatMessage[]
    setNotebookMessages: (messages: NotebookChatMessage[]) => void
    appendNotebookMessage: (message: NotebookChatMessage) => void
    updateLastNotebookMessage: (partial: Partial<NotebookChatMessage>) => void
    notebookNotes: NotebookNote[]
    setNotebookNotes: (notes: NotebookNote[]) => void
    notebookArtifacts: Artifact[]
    setNotebookArtifacts: (artifacts: Artifact[]) => void
    notebookConfig: NotebookConfig | null
    setNotebookConfig: (config: NotebookConfig | null) => void
}

// ── Notebook workspace types ─────────────────────────────────────────────────

export type SourceKind = 'text' | 'url' | 'youtube' | 'pdf' | 'audio' | 'image'

export interface SourceMeta {
    id: string          // sourceId slug (filename without .md)
    notebook: string
    entryId: string     // full entry id "notebooks/{nb}/{filename}"
    title: string
    type: SourceKind
    source: string | null  // original URL / filename
    date: string | null
    author: string | null
    summary: string | null
    wordCount?: number
}

export interface SourceGuide {
    summary: string
    keyTopics: string[]
    suggestedQuestions: string[]
    generatedAt: string
}

export interface NotebookConfig {
    emoji?: string
    description?: string
    chatStyle?: 'default' | 'study-guide' | 'custom'
    customStyle?: string
    answerLength?: 'short' | 'default' | 'long'
    overview?: string
    overviewUpdatedAt?: string
}

export interface NotebookNote {
    id: string
    title: string
    content: string
    source: 'user' | 'ai-chat' | 'ai-quick-action'
    createdAt: string
    updatedAt: string
}

export type ArtifactType = 'mindmap' | 'report' | 'audio'

export interface Artifact {
    id: string
    type: ArtifactType
    subtype?: string  // e.g. report subtype: briefing/faq/study-guide
    title: string
    data: Record<string, unknown>  // mindmap: { markdown }; report: { markdown }; audio: { script: [{speaker,text}] }
    createdAt: string
    sourceIds: string[]
}

export interface ParsedCitation {
    n: number
    label?: string
}

export interface NotebookChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations?: number[]     // citation numbers referenced in this message
    citedSources?: { n: number; sourceId: string; title: string }[]  // map 【N】 → source metadata
    timestamp: number
    streaming?: boolean
}
