/**
 * api.ts — HTTP client for the Neo Koa backend.
 * Token is stored in localStorage and sent as Authorization: Bearer <token>.
 */

export function getToken(): string {
    return localStorage.getItem('neo_token') ?? ''
}

export function saveToken(token: string) {
    localStorage.setItem('neo_token', token)
}

export function clearToken() {
    localStorage.removeItem('neo_token')
}

function authHeaders(): HeadersInit {
    const token = getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── REST helper ───────────────────────────────────────────────────────────────

export async function apiGet<T = unknown>(path: string): Promise<T> {
    const res = await fetch(path, { headers: authHeaders() })
    if (res.status === 401) {
        clearToken()
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

// ── Chat SSE stream ───────────────────────────────────────────────────────────

export interface StreamChunk {
    type: 'text' | 'thought' | 'tool_call' | 'done' | 'error' | 'image'
    text?: string
    toolName?: string
    data?: string      // base64 image data (for 'image' type)
    mimeType?: string  // e.g. 'image/png' (for 'image' type)
    caption?: string   // optional caption (for 'image' type)
}

export async function* streamChat(
    message: string,
    sessionId: string,
    signal?: AbortSignal,
    model?: string,
): AsyncGenerator<StreamChunk> {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
        },
        body: JSON.stringify({ message, sessionId, ...(model ? { model } : {}) }),
        signal,
    })

    if (res.status === 401) {
        clearToken()
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const data = line.slice(6).trim()
                if (!data) continue
                try {
                    yield JSON.parse(data) as StreamChunk
                } catch { /* skip malformed */ }
            }
        }
    } finally {
        reader.releaseLock()
    }
}

// ── Notebook API ──────────────────────────────────────────────────────────────

export function notebookList() {
    return apiGet('/api/notebook?action=list')
}

export function notebookSearch(q: string) {
    return apiGet(`/api/notebook?action=search&q=${encodeURIComponent(q)}`)
}

export function notebookRead(id: number) {
    return apiGet(`/api/notebook?action=read&id=${id}`)
}

export function notebookCreate(data: {
    title: string
    author?: string | null
    date?: string | null
    source?: string | null
    summary?: string | null
    tags?: string | null
    content?: string | null
}) {
    return fetch('/api/notebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<import('./types').NoteEntry>
    })
}

export function notebookUpdate(id: number, data: {
    title?: string
    author?: string | null
    date?: string | null
    source?: string | null
    summary?: string | null
    tags?: string | null
    content?: string | null
}) {
    return fetch(`/api/notebook/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<import('./types').NoteEntry>
    })
}

export function notebookDelete(id: number) {
    return fetch(`/api/notebook/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
    })
}

// ── Session API ───────────────────────────────────────────────────────────────

export function sessionNew(sessionId: string, title: string) {
    return fetch('/api/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sessionId, title }),
    })
}

export function sessionClear(sessionId: string) {
    return fetch('/api/session/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sessionId }),
    })
}

export function sessionList() {
    return apiGet<Array<{ sessionId: string; title: string; updatedAt: string }>>('/api/session/list')
}

// ── Todo API ──────────────────────────────────────────────────────────────────
import type { TodoItem, TodoAnalysis, InboxNote, NoteHeatmapDay, NoteTag } from './types'

export function todoList() {
    return apiGet<TodoItem[]>('/api/todos')
}

export function todoAnalyze(content: string) {
    return fetch('/api/todos/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content }),
    }).then((r) => r.json() as Promise<TodoAnalysis>)
}

export function todoCreate(content: string, priority?: string | null, remindAt?: string | null) {
    return fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content, priority: priority ?? undefined, remind_at: remindAt ?? undefined }),
    }).then((r) => r.json() as Promise<TodoItem>)
}

export function todoUpdateStatus(id: string, status: string) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
    }).then((r) => r.json())
}

export function todoUpdate(id: string, patch: { content?: string; remind_at?: string | null; priority?: string | null }) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
    }).then((r) => r.json())
}

export function todoDelete(id: string) {
    return fetch(`/api/todos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
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
    return fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content, ...(tags?.length ? { tags } : {}) }),
    }).then((r) => r.json() as Promise<InboxNote>)
}

export function noteDelete(id: number) {
    return fetch(`/api/notes/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
    }).then((r) => r.json())
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
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled }),
    }).then((r) => r.json())
}

export function cronUpdateSchedule(name: string, schedule: string) {
    return fetch(`/api/crons/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ schedule }),
    }).then((r) => r.json())
}

export function cronRuns(name: string, limit = 20) {
    return apiGet<CronRunInfo[]>(`/api/crons/${encodeURIComponent(name)}/runs?limit=${limit}`)
}

export function cronTrigger(name: string) {
    return fetch(`/api/crons/${encodeURIComponent(name)}/run`, {
        method: 'POST',
        headers: authHeaders(),
    }).then((r) => r.json()) as Promise<{ status: string; summary?: string; error?: string }>
}

// ── Auth check ────────────────────────────────────────────────────────────────
export type AuthResult = 'ok' | 'unauthorized' | 'unreachable'

export async function checkAuth(): Promise<AuthResult> {
    try {
        await apiGet('/api/notebook?action=list')
        return 'ok'
    } catch (err: unknown) {
        const e = err as { status?: number; message?: string }
        if (e?.status === 401) return 'unauthorized'
        // Network error (ECONNREFUSED, etc.) — backend not running
        const msg = e?.message ?? ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
            return 'unreachable'
        }
        // Other HTTP error — token may still be valid, treat as ok
        return 'ok'
    }
}
