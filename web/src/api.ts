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
    type: 'text' | 'thought' | 'done' | 'error'
    text?: string
}

export async function* streamChat(
    message: string,
    history: string,
    signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
        },
        body: JSON.stringify({ message, history }),
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

// ── Auth check ────────────────────────────────────────────────────────────────

export async function checkAuth(): Promise<boolean> {
    try {
        await apiGet('/api/notebook?action=list')
        return true
    } catch (err: unknown) {
        const e = err as { status?: number }
        return e?.status !== 401
    }
}
