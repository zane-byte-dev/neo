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

export type ConfirmStatus = 'pending' | 'approved' | 'denied' | 'submitted' | 'cancelled' | 'expired'
export type ApprovalScope = 'once' | 'session' | 'always'

export interface StreamChunk {
    type: 'run' | 'session' | 'text' | 'thought' | 'tool_call' | 'tool_result' | 'tool_confirm' | 'confirm_resolved' | 'citations' | 'done' | 'error' | 'image' | 'video' | 'todo_update'
    text?: string
    toolName?: string
    args?: Record<string, unknown>  // tool call arguments
    result?: string                 // tool result (truncated)
    resultId?: string               // cache id for full tool_result (GET /api/tool-result/:id)
    truncated?: boolean             // whether `result` is a preview
    confirmId?: string              // set on 'tool_confirm' chunks
    confirmStatus?: ConfirmStatus
    runId?: string
    actionId?: string
    approvalScope?: ApprovalScope
    cursor?: number
    url?: string       // image URL path (for 'image' type)
    caption?: string   // optional caption (for 'image' type)
    todos?: { id: number; title: string; status: string }[]  // todo list snapshot
    /** For 'session' type — server-resolved session id (e.g. notebook auto-bind). */
    sessionId?: string
    /** For 'citations' type — final notebook 【N】 citation map for the assistant message. */
    citations?: import('./types').ParsedCitation[]
}

type RuntimeRunStatus = 'queued' | 'running' | 'waiting_confirm' | 'waiting_input' | 'completed' | 'failed' | 'cancelled' | 'expired'

interface RuntimeRunRecord {
    id: string
    status: RuntimeRunStatus
    lastError?: { message?: string }
}

interface RuntimeRunResponse {
    run: RuntimeRunRecord
}

interface RuntimeRunEvent {
    runId: string
    index: number
    type: string
    payload: Record<string, unknown>
}

interface RuntimeRunEventsResponse {
    events: RuntimeRunEvent[]
    nextCursor: number
}

const RUN_EVENT_POLL_MS = 300
const RUN_EVENT_RETRY_MS = 1000

function isTerminalChunk(chunk: StreamChunk): boolean {
    return chunk.type === 'done' || chunk.type === 'error'
}

function isTerminalRunStatus(status: RuntimeRunStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired'
}

function toolResultKey(toolName: string | undefined, resultId: string | undefined): string {
    return resultId ? `id:${resultId}` : `tool:${toolName ?? 'unknown'}`
}

function toConfirmStatus(value: unknown): ConfirmStatus | undefined {
    if (
        value === 'pending'
        || value === 'approved'
        || value === 'denied'
        || value === 'submitted'
        || value === 'cancelled'
        || value === 'expired'
    ) {
        return value
    }
    return undefined
}

function toApprovalScope(value: unknown): ApprovalScope | undefined {
    if (value === 'once' || value === 'session' || value === 'always') return value
    return undefined
}

function mapRunEventToStreamChunk(
    event: RuntimeRunEvent,
    state: { pendingToolResults: Map<string, { resultId?: string; truncated?: boolean }> },
): StreamChunk | null {
    switch (event.type) {
        case 'llm_chunk': {
            const chunkType = typeof event.payload.chunkType === 'string' ? event.payload.chunkType : ''
            const text = typeof event.payload.text === 'string' ? event.payload.text : undefined
            const toolName = typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined
            const resultId = typeof event.payload.resultId === 'string' ? event.payload.resultId : undefined
            const truncated = event.payload.truncated === true
            if (chunkType === 'text' || chunkType === 'thought') {
                return text !== undefined ? { type: chunkType, text, cursor: event.index } : null
            }
            if (chunkType === 'tool_result') {
                state.pendingToolResults.set(toolResultKey(toolName, resultId), { resultId, truncated })
            }
            return null
        }
        case 'tool_call_started':
            return {
                type: 'tool_call',
                toolName: typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined,
                args: typeof event.payload.args === 'object' && event.payload.args !== null ? event.payload.args as Record<string, unknown> : undefined,
                cursor: event.index,
            }
        case 'tool_call_finished': {
            const toolName = typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined
            const resultId = typeof event.payload.resultId === 'string' ? event.payload.resultId : undefined
            const key = toolResultKey(toolName, resultId)
            const pending = state.pendingToolResults.get(key)
            state.pendingToolResults.delete(key)
            return {
                type: 'tool_result',
                toolName,
                result: typeof event.payload.resultPreview === 'string' ? event.payload.resultPreview : undefined,
                resultId: pending?.resultId ?? resultId,
                truncated: pending?.truncated,
                cursor: event.index,
            }
        }
        case 'todo_updated':
            return {
                type: 'todo_update',
                todos: Array.isArray(event.payload.todos) ? event.payload.todos as StreamChunk['todos'] : undefined,
                cursor: event.index,
            }
        case 'artifact_created': {
            const artifact = typeof event.payload.artifact === 'object' && event.payload.artifact !== null
                ? event.payload.artifact as Record<string, unknown>
                : null
            if (!artifact) return null
            if (artifact.kind === 'image' && typeof artifact.url === 'string') {
                return {
                    type: 'image',
                    url: artifact.url,
                    caption: typeof artifact.title === 'string' ? artifact.title : undefined,
                    cursor: event.index,
                }
            }
            if (artifact.kind === 'video' && typeof artifact.url === 'string') {
                return { type: 'video', url: artifact.url, cursor: event.index }
            }
            return null
        }
        case 'confirm_requested':
            return {
                type: 'tool_confirm',
                confirmId: typeof event.payload.actionId === 'string' ? event.payload.actionId : undefined,
                actionId: typeof event.payload.actionId === 'string' ? event.payload.actionId : undefined,
                runId: event.runId,
                toolName: typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined,
                args: typeof event.payload.args === 'object' && event.payload.args !== null ? event.payload.args as Record<string, unknown> : undefined,
                cursor: event.index,
            }
        case 'confirm_resolved':
            return {
                type: 'confirm_resolved',
                confirmId: typeof event.payload.actionId === 'string' ? event.payload.actionId : undefined,
                actionId: typeof event.payload.actionId === 'string' ? event.payload.actionId : undefined,
                runId: event.runId,
                confirmStatus: toConfirmStatus(event.payload.status),
                approvalScope: toApprovalScope(event.payload.approvalScope),
                cursor: event.index,
            }
        case 'notebook_citations': {
            const citations = Array.isArray(event.payload.citations)
                ? event.payload.citations as import('./types').ParsedCitation[]
                : []
            if (citations.length === 0) return null
            return { type: 'citations', citations, cursor: event.index }
        }
        case 'run_completed':
            return { type: 'done', cursor: event.index }
        case 'run_failed': {
            const error = typeof event.payload.error === 'object' && event.payload.error !== null
                ? event.payload.error as Record<string, unknown>
                : undefined
            return {
                type: 'error',
                text: typeof error?.message === 'string' ? error.message : 'Run failed',
                cursor: event.index,
            }
        }
        default:
            return null
    }
}

async function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return
    await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms)
        function done() {
            clearTimeout(timer)
            signal?.removeEventListener('abort', done)
            resolve()
        }
        signal?.addEventListener('abort', done, { once: true })
    })
}

export interface UserPreferences {
    defaultModel?: string
    enabledModels?: string[]
    telegramBotEnabled?: boolean
}

export interface ToolApprovalRule {
    id: string
    toolName: string
    policyKey: string
    scope: 'session' | 'always'
    createdAt: string
    updatedAt: string
    sessionId?: string
    args?: Record<string, unknown>
}

export interface TelegramRuntimeInfo {
    configured: boolean
    active: boolean
}

export interface PreferencesResponse {
    preferences: UserPreferences
    availableModels?: string[]
    telegram: TelegramRuntimeInfo
}

export interface ToolApprovalsResponse {
    rules: ToolApprovalRule[]
}

export interface MessageActivityItem {
    type: 'tool_call' | 'tool_result' | 'tool_confirm'
    toolName: string
    args?: Record<string, unknown>
    result?: string
    resultId?: string
    truncated?: boolean
    confirmId?: string
    runId?: string
    actionId?: string
    confirmStatus?: ConfirmStatus
    approvalScope?: ApprovalScope
    timestamp: number
}

export type MessageHistoryPart =
    | { type: 'text'; content: string }
    | { type: 'activity'; item: MessageActivityItem }

export interface MessageHistoryRow {
    id: string
    role: string
    content: string
    timestamp: number
    activityLog?: MessageActivityItem[]
    parts?: MessageHistoryPart[]
    citations?: import('./types').ParsedCitation[]
}

export function fetchPreferences(): Promise<PreferencesResponse> {
    return apiGet<PreferencesResponse>('/api/preferences')
}

export function savePreferences(preferences: UserPreferences): Promise<PreferencesResponse> {
    return _post('/api/preferences', preferences).then((r) => _jsonOrThrow<PreferencesResponse>(r))
}

export type SecretKey =
    | 'GEMINI_API_KEY'
    | 'DEEPSEEK_API_KEY'
    | 'OPENAI_API_KEY'
    | 'ANTHROPIC_API_KEY'
    | 'TELEGRAM_BOT_TOKEN'
    | 'TELEGRAM_CHAT_ID'

export interface SecretStatus {
    hasValue: boolean
    source: 'file' | 'env' | 'none'
    masked: string
}

export interface SecretsResponse {
    secrets: Record<SecretKey, SecretStatus>
}

export function fetchSecrets(): Promise<SecretsResponse> {
    return apiGet<SecretsResponse>('/api/secrets')
}

export function saveSecrets(patch: Partial<Record<SecretKey, string>>): Promise<SecretsResponse> {
    return _post('/api/secrets', patch).then((r) => _jsonOrThrow<SecretsResponse>(r))
}

export function fetchToolApprovals(): Promise<ToolApprovalsResponse> {
    return apiGet<ToolApprovalsResponse>('/api/tool-approvals')
}

export async function deleteToolApproval(ruleId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/tool-approvals/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
        credentials: 'include',
    })
    if (res.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
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
    confirmDangerous?: boolean,
    notebookId?: string,
    sourceIds?: string[],
): AsyncGenerator<StreamChunk> {
    const requestBody = {
        message,
        sessionId,
        ...(model ? { model } : {}),
        ...(images?.length ? { images } : {}),
        ...(documents?.length ? { documents } : {}),
        ...(confirmDangerous ? { confirmDangerous: true } : {}),
        ...(notebookId ? { notebookId } : {}),
        ...(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
    }
    let runId: string | undefined
    let lastCursor = -1
    let streamError: unknown = null
    let terminal = false

    try {
        for await (const chunk of createSSEStream<StreamChunk>('/api/chat', requestBody, { signal })) {
            if (chunk.type === 'run' && chunk.runId) runId = chunk.runId
            if (typeof chunk.cursor === 'number') lastCursor = Math.max(lastCursor, chunk.cursor)
            terminal = terminal || isTerminalChunk(chunk)
            yield chunk
        }
    } catch (err: unknown) {
        if (signal?.aborted) throw err
        streamError = err
    }

    if (terminal || signal?.aborted) {
        if (streamError) throw streamError
        return
    }
    if (!runId) {
        if (streamError) throw streamError
        throw new Error('Chat stream ended before runId was received')
    }

    const state = { pendingToolResults: new Map<string, { resultId?: string; truncated?: boolean }>() }
    while (!signal?.aborted) {
        try {
            const { events, nextCursor } = await fetchRunEvents(runId, lastCursor)
            if (events.length > 0) {
                lastCursor = nextCursor
                for (const event of events) {
                    const chunk = mapRunEventToStreamChunk(event, state)
                    if (!chunk) continue
                    terminal = terminal || isTerminalChunk(chunk)
                    yield chunk
                    if (terminal) return
                }
            }

            const run = await fetchRun(runId)
            if (isTerminalRunStatus(run.status)) {
                if (run.status === 'completed') {
                    yield { type: 'done' }
                } else {
                    yield {
                        type: 'error',
                        text: run.lastError?.message ?? `Run ${run.status}`,
                    }
                }
                return
            }
            await waitFor(events.length > 0 ? 0 : RUN_EVENT_POLL_MS, signal)
        } catch (err: unknown) {
            if (signal?.aborted) throw err
            if (streamError) {
                throw streamError
            }
            streamError = err
            await waitFor(RUN_EVENT_RETRY_MS, signal)
        }
    }
}

/** Approve or deny a paused dangerous tool call. */
export async function confirmTool(input: { approved: boolean; confirmId?: string; runId?: string; actionId?: string; approvalScope?: ApprovalScope }): Promise<void> {
    const body = input.runId && input.actionId
        ? {
            runId: input.runId,
            actionId: input.actionId,
            approved: input.approved,
            ...(input.approvalScope ? { approvalScope: input.approvalScope } : {}),
        }
        : {
            confirmId: input.confirmId,
            approved: input.approved,
            ...(input.approvalScope ? { approvalScope: input.approvalScope } : {}),
        }
    const res = await _post('/api/tool-confirm', body)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export function fetchRun(runId: string): Promise<RuntimeRunRecord> {
    return apiGet<RuntimeRunResponse>(`/api/runs/${encodeURIComponent(runId)}`).then((res) => res.run)
}

export function fetchRunEvents(runId: string, cursor = -1, limit = 200): Promise<RuntimeRunEventsResponse> {
    return apiGet<RuntimeRunEventsResponse>(
        `/api/runs/${encodeURIComponent(runId)}/events?cursor=${cursor}&limit=${limit}`,
    )
}

export function cancelRun(runId: string): Promise<{ ok: boolean; status: string; alreadyTerminal?: boolean }> {
    return _post(`/api/runs/${encodeURIComponent(runId)}/cancel`).then((r) => _jsonOrThrow(r))
}

/** Fetch the full payload of a previously streamed tool_result. */
export async function fetchToolResult(resultId: string): Promise<{ id: string; toolName: string; result: string; createdAt: number }> {
    return apiGet(`/api/tool-result/${encodeURIComponent(resultId)}`)
}

// ── Skills API ────────────────────────────────────────────────────────────────

export interface SkillSummary {
    name: string
    description: string
    tags: string[]
    version: string | null
    enabled: boolean
    hasExecutable: boolean
    filePath: string
}

export interface SkillDetail extends SkillSummary {
    body: string
    executableBlocks: Array<{ lang: string; code: string }>
    rawContent: string
}

export interface SkillsResponse {
    skills: SkillSummary[]
}

export function fetchSkills(): Promise<SkillsResponse> {
    return apiGet<SkillsResponse>('/api/skills')
}

export function fetchSkill(name: string): Promise<SkillDetail> {
    return apiGet<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`)
}

export async function createSkill(rawContent: string): Promise<{ ok: boolean; name: string }> {
    const res = await _post('/api/skills', { rawContent })
    return _jsonOrThrow(res)
}

export async function toggleSkill(name: string, enabled: boolean): Promise<{ ok: boolean; name: string; enabled: boolean }> {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return _jsonOrThrow(res)
}

export async function updateSkill(name: string, rawContent: string): Promise<{ ok: boolean; name: string }> {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawContent }),
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return _jsonOrThrow(res)
}

export async function deleteSkill(name: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'include',
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return _jsonOrThrow(res)
}

// ── User Apps API ─────────────────────────────────────────────────────────────

export interface UserAppInfo {
    name: string
    title: string
    description: string | null
    icon: string | null
    hasIndex: boolean
}

export async function fetchUserApps(): Promise<UserAppInfo[]> {
    const r = await apiGet<{ apps?: UserAppInfo[] }>('/api/apps')
    return r.apps ?? []
}

export async function uploadAppFiles(appName: string, files: File[]): Promise<string[]> {
    const formData = new FormData()
    for (const f of files) formData.append('files', f, f.name)
    const res = await fetch(`/api/apps/${encodeURIComponent(appName)}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`)
    }
    const data = await res.json() as { saved?: string[] }
    return data.saved ?? []
}

export async function deleteUserApp(appName: string): Promise<void> {
    const res = await fetch(`/api/apps/${encodeURIComponent(appName)}`, {
        method: 'DELETE',
        credentials: 'include',
    })
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`)
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

export function notebookDeleteFolder(name: string): Promise<{ ok: true }> {
    return fetch(`/api/notebook/folder?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'include',
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
    })
}

export function notebookRenameFolder(name: string, newName: string): Promise<{ ok: true; name: string }> {
    return fetch('/api/notebook/folder', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newName }),
    }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
    })
}

// ── Notebook workspace (NotebookLM-style) ────────────────────────────────────

import type {
    SourceMeta, SourceGuide, NotebookConfig, NotebookNote, Artifact, ArtifactType,
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

export function notebookListSourcesWithGuides(notebook: string): Promise<(SourceMeta & { guide: SourceGuide | null })[]> {
    return apiGet(`/api/notebook/source?action=list-with-guides&notebook=${encodeURIComponent(notebook)}`)
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

// ── Session API ───────────────────────────────────────────────────────────────

export function sessionNew(sessionId: string, title: string) {
    return _post('/api/session/new', { sessionId, title })
}

export function sessionClear(sessionId: string, projectRoot?: string | null) {
    return _post('/api/session/clear', {
        sessionId,
        ...(projectRoot ? { projectRoot } : {}),
    })
}

export function sessionList() {
    return apiGet<Array<{ sessionId: string; title: string; updatedAt: string }>>('/api/session/list')
}

export function fetchSessions() {
    return apiGet<Array<{
        id: string;
        title: string;
        isPinned: boolean;
        isArchived?: boolean;
        createdAt: number;
        updatedAt?: number;
        projectRoot: string | null;
        mode?: 'general' | 'notebook';
        notebookId?: string;
        sourceIds?: string[];
    }>>('/api/sessions')
}

export function patchSession(
    id: string,
    patch: {
        title?: string;
        isPinned?: boolean;
        isArchived?: boolean;
        projectRoot?: string | null;
        sourceIds?: string[] | null;
    },
) {
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

export interface NotebookSessionRow {
    id: string
    title: string
    isPinned: boolean
    isArchived?: boolean
    createdAt: number
    updatedAt?: number
    projectRoot: string | null
    mode: 'notebook'
    notebookId: string
    sourceIds?: string[]
}

/** Find or create the (single) chat session bound to a notebook. */
export async function openNotebookSession(notebookId: string, sourceIds?: string[]): Promise<NotebookSessionRow> {
    const res = await fetch('/api/sessions/notebook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId, ...(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}) }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`)
    }
    const data = await res.json() as { session: NotebookSessionRow }
    return data.session
}

export function fetchMessages(sessionId: string) {
    return apiGet<MessageHistoryRow[]>(
        `/api/messages?sessionId=${encodeURIComponent(sessionId)}`
    )
}

// ── Project (recent project directories) API ─────────────────────────────────

export interface ProjectEntry {
    id: string
    name: string
    path: string
    lastUsedAt: string
}

export function fetchProjects() {
    return apiGet<{ projects: ProjectEntry[] }>('/api/projects')
}

export function registerProjectApi(path: string, name?: string) {
    return _post('/api/projects', { path, ...(name ? { name } : {}) }).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e))
        return r.json() as Promise<ProjectEntry>
    })
}

export function deleteProjectApi(id: string) {
    return fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    })
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

export async function initializeWorkspace(): Promise<MeInfo & { ok: boolean }> {
    const res = await _post('/api/me/workspace/init')
    if (res.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

// ── Model / usage API ─────────────────────────────────────────────────────────

export interface ModelInfo {
    alias: string
    modelId: string
    provider: string
    pricing: { input: number; output: number }
    free: boolean
    tiers: string[]
    configured: boolean
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
    systemPrompt?: string
    userPrompt?: string
}

export interface ProviderStatus {
    provider: 'google' | 'gemini-acp' | 'deepseek' | 'openai' | 'anthropic' | 'ollama'
    ok: boolean
    detail?: string
    meta?: Record<string, string | number | boolean | undefined>
}

export type RoutingTier = 'simple' | 'standard' | 'complex'

export interface RoutingConfigData {
    tiers: Record<RoutingTier, string[]>
    boundaries: { simpleMax: number; standardMax: number }
    overrides: { toolFloor: RoutingTier; largeContextFloor: RoutingTier; largeContextThreshold: number }
    momentum: { historySize: number; maxWeight: number; messageThreshold: number }
    confidence: { k: number; fallbackThreshold: number }
}

export interface ModelsResponse {
    models: ModelInfo[]
    providerStatus: ProviderStatus[]
    routing: RoutingConfigData
    routingDefaults: RoutingConfigData
    usage: MonthlyUsageSummary
    history: UsageRecord[]
    dailyCost: number
    dailyCostLimit: number
}

export function fetchModels(month?: string): Promise<ModelsResponse> {
    const qs = month ? `?month=${encodeURIComponent(month)}` : ''
    return apiGet<ModelsResponse>(`/api/models${qs}`)
}

export async function saveRouting(partial: Partial<RoutingConfigData>): Promise<{ ok: boolean; routing: RoutingConfigData }> {
    const res = await fetch('/api/models/routing', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
    })
    if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
    }
    return res.json()
}

export async function resetRouting(): Promise<{ ok: boolean; routing: RoutingConfigData }> {
    const res = await _post('/api/models/routing/reset')
    if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
    }
    return res.json()
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
