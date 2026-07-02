/**
 * stream-transport.ts — Unified SSE transport for the frontend.
 *
 * Provides a reusable AsyncGenerator-based SSE client that handles:
 * - fetch with credentials & abort signal
 * - ReadableStream consumption & line-based SSE parsing
 * - Auth error detection (401 → typed error)
 * - Graceful reader cleanup
 *
 * Usage:
 *   for await (const event of createSSEStream<MyEvent>('/api/chat', body, signal)) { ... }
 */

export interface SSERequestOptions {
    signal?: AbortSignal
    /** Extra headers beyond Content-Type: application/json */
    headers?: Record<string, string>
}

/**
 * Open an SSE connection via POST and yield parsed JSON events.
 *
 * @typeParam T - The event type yielded from the stream.
 * @param url - API endpoint (e.g. '/api/chat')
 * @param body - JSON-serialisable request body
 * @param opts - Optional abort signal and extra headers
 */
export async function* createSSEStream<T>(
    url: string,
    body: unknown,
    opts?: SSERequestOptions,
): AsyncGenerator<T> {
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...opts?.headers,
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
    })

    if (res.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
    }
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
                    yield JSON.parse(data) as T
                } catch { /* skip malformed JSON */ }
            }
        }
    } finally {
        reader.releaseLock()
    }
}
