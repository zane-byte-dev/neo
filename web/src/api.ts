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
): AsyncGenerator<StreamChunk> {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
        },
        body: JSON.stringify({ message, sessionId }),
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
