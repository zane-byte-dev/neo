/**
 * api.ts — HTTP client for the Neo Koa backend.
 * Authentication uses httpOnly session cookies set by /api/auth/login.
 * All fetch calls use credentials: 'include' so cookies are sent automatically.
 */

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
    type: 'text' | 'thought' | 'tool_call' | 'done' | 'error' | 'image'
    text?: string
    toolName?: string
    url?: string       // image URL path (for 'image' type)
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, ...(model ? { model } : {}) }),
        signal,
    })

    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
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
