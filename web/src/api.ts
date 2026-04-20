/**
 * api.ts — HTTP client for the Neo Koa backend.
 * Authentication uses httpOnly session cookies set by /api/auth/login.
 * All fetch calls use credentials: 'include' so cookies are sent automatically.
 */

import { createSSEStream } from './lib/stream-transport.js'

// ── REST helper ───────────────────────────────────────────────────────────────

export async function apiGet<T = unknown>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' })
    if (res.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

function _post(path: string, body?: unknown): Promise<Response> {
    return fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
}

// ── Chat SSE stream ───────────────────────────────────────────────────────────

export interface StreamChunk {
    type: 'text' | 'thought' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'image' | 'video' | 'todo_update'
    text?: string
    toolName?: string
    args?: Record<string, unknown>  // tool call arguments
    result?: string                 // tool result (truncated)
    url?: string       // image URL path (for 'image' type)
    caption?: string   // optional caption (for 'image' type)
    todos?: { id: number; title: string; status: string }[]  // todo list snapshot
}

// ── File upload ───────────────────────────────────────────────────────────────

export interface UploadedImage {
    type: 'image'
    dataUrl: string
    filename: string
}

export interface UploadedDocument {
    type: 'document'
    filename: string
    text: string
    pageCount?: number
    mimeType: string
}

export type UploadedFile = UploadedImage | UploadedDocument

export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
    const formData = new FormData()
    for (const file of files) {
        formData.append('files', file, file.name)
    }
    const res = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`)
    }
    const data = await res.json() as { files: UploadedFile[] }
    return data.files
}

export async function* streamChat(
    message: string,
    sessionId: string,
    signal?: AbortSignal,
    model?: string,
    images?: string[],
    documents?: { filename: string; text: string }[],
): AsyncGenerator<StreamChunk> {
    yield* createSSEStream<StreamChunk>('/api/chat', {
        message,
        sessionId,
        ...(model ? { model } : {}),
        ...(images?.length ? { images } : {}),
        ...(documents?.length ? { documents } : {}),
    }, { signal });
}

// ── Notebook API ──────────────────────────────────────────────────────────────

export function notebookListNotebooks(): Promise<string[]> {
    return apiGet('/api/notebook?action=notebooks')
}

export function notebookList(notebook?: string) {
    const nb = notebook ? `&notebook=${encodeURIComponent(notebook)}` : ''
    return apiGet(`/api/notebook?action=list${nb}`)
}

export function notebookSearch(q: string, notebook?: string) {
    const nb = notebook ? `&notebook=${encodeURIComponent(notebook)}` : ''
    return apiGet(`/api/notebook?action=search&q=${encodeURIComponent(q)}${nb}`)
}

export function notebookRead(id: string) {
    return apiGet(`/api/notebook?action=read&id=${encodeURIComponent(id)}`)
}

export function notebookCreate(notebook: string, data: {
    title: string
    author?: string | null
    date?: string | null
    source?: string | null
    summary?: string | null
    tags?: string | null
    content?: string | null
}) {
    return _post('/api/notebook', { ...data, notebook }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<import('./types').NoteEntry>
    })
}

export function notebookUpdate(id: string, data: {
    title?: string
    author?: string | null
    date?: string | null
    source?: string | null
    summary?: string | null
    tags?: string | null
    content?: string | null
}) {
    return fetch(`/api/notebook?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<import('./types').NoteEntry>
    })
}

export function notebookDelete(id: string) {
    return fetch(`/api/notebook?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
    })
}

// ── Notebook workspace (NotebookLM-style) ────────────────────────────────────

import type {
    SourceMeta, SourceGuide, NotebookConfig, NotebookNote, Artifact, NotebookChatMessage, ArtifactType,
} from './types'

async function _jsonOrThrow<T>(r: Response): Promise<T> {
    if (r.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error ?? `HTTP ${r.status}`)
    }
    return r.json() as Promise<T>
}

// Sources
export function notebookListSources(notebook: string): Promise<SourceMeta[]> {
    return apiGet(`/api/notebook/source?action=list&notebook=${encodeURIComponent(notebook)}`)
}

export function notebookGetSource(notebook: string, sourceId: string) {
    return apiGet<{ id: string; content: string } & SourceMeta>(
        `/api/notebook/source?action=read&notebook=${encodeURIComponent(notebook)}&sourceId=${encodeURIComponent(sourceId)}`,
    )
}

export function notebookGetSourceGuide(notebook: string, sourceId: string): Promise<SourceGuide> {
    return apiGet(`/api/notebook/source?action=guide&notebook=${encodeURIComponent(notebook)}&sourceId=${encodeURIComponent(sourceId)}`)
}

export function notebookGenerateSourceGuide(notebook: string, sourceId: string, model?: string): Promise<SourceGuide> {
    return _post('/api/notebook/source-guide', { notebook, sourceId, ...(model ? { model } : {}) }).then((r) => _jsonOrThrow<SourceGuide>(r))
}

export interface ImportSourcePayload {
    notebook: string
    kind: 'url' | 'text' | 'document'
    url?: string
    title?: string
    content?: string
    filename?: string
    mimeType?: string
    source?: string
}

export function notebookImportSource(payload: ImportSourcePayload): Promise<SourceMeta> {
    return _post('/api/notebook/import', payload).then((r) => _jsonOrThrow<SourceMeta>(r))
}

export function notebookArchiveSource(notebook: string, sourceId: string): Promise<{ ok: boolean }> {
    return _post('/api/notebook/source/archive', { notebook, sourceId }).then((r) => _jsonOrThrow<{ ok: boolean }>(r))
}

export function notebookRenameSource(notebook: string, sourceId: string, title: string): Promise<SourceMeta> {
    return _post('/api/notebook/source/rename', { notebook, sourceId, title }).then((r) => _jsonOrThrow<SourceMeta>(r))
}

// Config
export function notebookGetConfig(notebook: string): Promise<NotebookConfig> {
    return apiGet(`/api/notebook?action=config&notebook=${encodeURIComponent(notebook)}`)
}

export function notebookUpdateConfig(notebook: string, partial: Partial<NotebookConfig>): Promise<NotebookConfig> {
    return fetch('/api/notebook/config', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebook, ...partial }),
    }).then((r) => _jsonOrThrow<NotebookConfig>(r))
}

export function notebookGenerateOverview(notebook: string, sourceIds?: string[], model?: string): Promise<{ overview: string }> {
    return _post('/api/notebook/overview', { notebook, sourceIds, ...(model ? { model } : {}) }).then((r) => _jsonOrThrow<{ overview: string }>(r))
}

// Notes
export function notebookListNotes(notebook: string): Promise<NotebookNote[]> {
    return apiGet(`/api/notebook?action=notes&notebook=${encodeURIComponent(notebook)}`)
}

export function notebookSaveNote(notebook: string, note: { id?: string; title: string; content: string; source?: 'user' | 'ai-chat' | 'ai-quick-action' }): Promise<NotebookNote> {
    return _post('/api/notebook/note', { notebook, ...note }).then((r) => _jsonOrThrow<NotebookNote>(r))
}

export function notebookDeleteNote(notebook: string, id: string) {
    return fetch(`/api/notebook/note?notebook=${encodeURIComponent(notebook)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
    }).then((r) => _jsonOrThrow<{ ok: true }>(r))
}

export function notebookConvertNoteToSource(notebook: string, id: string): Promise<SourceMeta> {
    return _post('/api/notebook/note/convert', { notebook, id }).then((r) => _jsonOrThrow<SourceMeta>(r))
}

export type NoteQuickAction = 'merge' | 'outline' | 'feedback' | 'study-guide'

export function notebookNoteQuickAction(notebook: string, action: NoteQuickAction, ids: string[], model?: string): Promise<NotebookNote> {
    return _post('/api/notebook/note/quick-action', { notebook, action, ids, ...(model ? { model } : {}) }).then((r) => _jsonOrThrow<NotebookNote>(r))
}

// Artifacts
export function notebookListArtifacts(notebook: string, type?: ArtifactType): Promise<Artifact[]> {
    const t = type ? `&type=${encodeURIComponent(type)}` : ''
    return apiGet(`/api/notebook/studio?action=artifacts&notebook=${encodeURIComponent(notebook)}${t}`)
}

export function notebookGetArtifact(notebook: string, id: string): Promise<Artifact> {
    return apiGet(`/api/notebook/studio?action=artifact&notebook=${encodeURIComponent(notebook)}&id=${encodeURIComponent(id)}`)
}

export interface GenerateArtifactPayload {
    notebook: string
    type: ArtifactType
    sourceIds?: string[]
    // mindmap
    topic?: string
    // report
    subtype?: string
    customPrompt?: string
    title?: string
}

export function notebookGenerateArtifact(payload: GenerateArtifactPayload): Promise<Artifact> {
    return _post('/api/notebook/artifact', payload).then((r) => _jsonOrThrow<Artifact>(r))
}

export function notebookDeleteArtifact(notebook: string, id: string) {
    return fetch(`/api/notebook/artifact?notebook=${encodeURIComponent(notebook)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
    }).then((r) => _jsonOrThrow<{ ok: true }>(r))
}

// Chat
export function notebookChatHistory(notebook: string): Promise<NotebookChatMessage[]> {
    return apiGet(`/api/notebook/chat?notebook=${encodeURIComponent(notebook)}`)
}

export function notebookClearChat(notebook: string) {
    return fetch(`/api/notebook/chat?notebook=${encodeURIComponent(notebook)}`, {
        method: 'DELETE', credentials: 'include',
    }).then((r) => _jsonOrThrow<{ ok: true }>(r))
}

export function notebookForkChat(notebook: string, messageId: string): Promise<{ messages: NotebookChatMessage[] }> {
    return _post('/api/notebook/chat/fork', { notebook, messageId }).then((r) => _jsonOrThrow<{ messages: NotebookChatMessage[] }>(r))
}

export interface NotebookChatEvent {
    type: 'meta' | 'text' | 'citations' | 'done' | 'error'
    text?: string
    citations?: number[]
    sources?: { n: number; sourceId: string; title: string }[]
    error?: string
}

export async function* streamNotebookChat(
    notebook: string,
    message: string,
    sourceIds?: string[],
    signal?: AbortSignal,
    model?: string,
): AsyncGenerator<NotebookChatEvent> {
    yield* createSSEStream<NotebookChatEvent>('/api/notebook/chat', {
        notebook,
        message,
        ...(sourceIds ? { sourceIds } : {}),
        ...(model ? { model } : {}),
    }, { signal });
}


// ── Session API ───────────────────────────────────────────────────────────────

export function sessionNew(sessionId: string, title: string) {
    return _post('/api/session/new', { sessionId, title })
}

export function sessionClear(sessionId: string) {
    return _post('/api/session/clear', { sessionId })
}

export function sessionList() {
    return apiGet<Array<{ sessionId: string; title: string; updatedAt: string }>>('/api/session/list')
}

export function fetchSessions() {
    return apiGet<Array<{ id: string; title: string; isPinned: boolean; createdAt: number }>>('/api/sessions')
}

export function patchSession(id: string, patch: { title?: string; isPinned?: boolean }) {
    return fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    })
}

export function deleteSessionApi(id: string) {
    return fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    })
}

export function fetchMessages(sessionId: string) {
    return apiGet<Array<{ id: string; role: string; content: string; timestamp: number }>>(
        `/api/messages?sessionId=${encodeURIComponent(sessionId)}`
    )
}

// ── Todo API ──────────────────────────────────────────────────────────────────
import type { TodoItem, TodoAnalysis, InboxNote, NoteHeatmapDay, NoteTag } from './types'

export function todoList() {
    return apiGet<TodoItem[]>('/api/todos')
}

export function todoAnalyze(content: string) {
    return _post('/api/todos/analyze', { content }).then((r) => r.json() as Promise<TodoAnalysis>)
}

export function todoCreate(content: string, priority?: string | null, remindAt?: string | null) {
    return _post('/api/todos', { content, priority: priority ?? undefined, remind_at: remindAt ?? undefined })
        .then((r) => r.json() as Promise<TodoItem>)
}

export function todoUpdateStatus(id: string, status: string) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    }).then((r) => r.json())
}

export function todoUpdate(id: string, patch: { content?: string; remind_at?: string | null; priority?: string | null }) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    }).then((r) => r.json())
}

export function todoDelete(id: string) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    }).then((r) => r.json())
}

// ── Notes (Inbox) API ─────────────────────────────────────────────────────────

export function noteList(opts?: { date?: string; tag?: string }) {
    const params = new URLSearchParams()
    if (opts?.date) params.set('date', opts.date)
    if (opts?.tag) params.set('tag', opts.tag)
    const qs = params.toString() ? `?${params}` : ''
    return apiGet<InboxNote[]>(`/api/notes${qs}`)
}

export function noteCreate(content: string, tags?: string[]) {
    return _post('/api/notes', { content, ...(tags?.length ? { tags } : {}) })
        .then((r) => r.json() as Promise<InboxNote>)
}

export function noteDelete(id: number) {
    return fetch(`/api/notes/${id}`, { method: 'DELETE', credentials: 'include' }).then((r) => r.json())
}

export function noteStats() {
    return apiGet<NoteHeatmapDay[]>('/api/notes/stats')
}

export function noteTags() {
    return apiGet<NoteTag[]>('/api/notes/tags')
}

// ── Cron API ──────────────────────────────────────────────────────────────────

import type { CronJobInfo, CronRunInfo } from './types'

export function cronList() {
    return apiGet<CronJobInfo[]>('/api/crons')
}

export function cronToggle(name: string, enabled: boolean) {
    return fetch(`/api/crons/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    }).then((r) => r.json())
}

export function cronUpdateSchedule(name: string, schedule: string) {
    return fetch(`/api/crons/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
    }).then((r) => r.json())
}

export function cronRuns(name: string, limit = 20) {
    return apiGet<CronRunInfo[]>(`/api/crons/${encodeURIComponent(name)}/runs?limit=${limit}`)
}

export function cronTrigger(name: string) {
    return fetch(`/api/crons/${encodeURIComponent(name)}/run`, {
        method: 'POST',
        credentials: 'include',
    }).then((r) => r.json()) as Promise<{ status: string; summary?: string; error?: string }>
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export type AuthResult = 'ok' | 'unauthorized' | 'unreachable'

/** Exchange a webToken for a session cookie. */
export async function login(token: string): Promise<AuthResult> {
    try {
        const res = await _post('/api/auth/login', { token })
        if (res.ok) return 'ok'
        if (res.status === 401) return 'unauthorized'
        return 'unauthorized'
    } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'unreachable'
        return 'unauthorized'
    }
}

/** Clear the session cookie. */
export async function logout(): Promise<void> {
    await _post('/api/auth/logout')
}

export async function checkAuth(): Promise<AuthResult> {
    try {
        await apiGet('/api/me')
        return 'ok'
    } catch (err: unknown) {
        const e = err as { status?: number; message?: string }
        if (e?.status === 401) return 'unauthorized'
        const msg = e?.message ?? ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
            return 'unreachable'
        }
        return 'ok'
    }
}

// ── Current user ─────────────────────────────────────────────────────────────

export interface MeInfo {
    userId: string | null
    displayName: string | null
    profile: string | null
}

export function fetchMe(): Promise<MeInfo> {
    return apiGet<MeInfo>('/api/me')
}

// ── Model / usage API ─────────────────────────────────────────────────────────

export interface ModelInfo {
    alias: string
    modelId: string
    provider: string
    pricing: { input: number; output: number }
    free: boolean
    tiers: string[]
}

export interface MonthlyUsageSummary {
    month: string
    totalPromptTokens: number
    totalCompletionTokens: number
    totalTokens: number
    callCount: number
    byModel: Record<string, {
        promptTokens: number
        completionTokens: number
        totalTokens: number
        callCount: number
    }>
}

export interface UsageRecord {
    timestamp: number
    userId: string
    model: string
    tier: string
    score: number
    confidence: number
    reason: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    estimatedCost: number
    durationMs: number
    fallbackUsed: boolean
    originalModel?: string
    sessionId?: string
}

export interface ModelsResponse {
    models: ModelInfo[]
    routing: {
        tiers: Record<string, string[]>
        boundaries: { simpleMax: number; standardMax: number }
        overrides: { toolFloor: string; largeContextFloor: string; largeContextThreshold: number }
        momentum: { historySize: number; maxWeight: number; messageThreshold: number }
        confidence: { k: number; fallbackThreshold: number }
    }
    usage: MonthlyUsageSummary
    history: UsageRecord[]
    dailyCost: number
    dailyCostLimit: number
}

export function fetchModels(month?: string): Promise<ModelsResponse> {
    const qs = month ? `?month=${encodeURIComponent(month)}` : ''
    return apiGet<ModelsResponse>(`/api/models${qs}`)
}

export interface SessionMessage {
    id: number
    session_id: string
    user_id: string
    role: string
    content: string
    user_name: string | null
    timestamp: string
}

export function fetchModelMessages(sessionId: string): Promise<{ messages: SessionMessage[] }> {
    return apiGet(`/api/models/messages?sessionId=${encodeURIComponent(sessionId)}`)
}
