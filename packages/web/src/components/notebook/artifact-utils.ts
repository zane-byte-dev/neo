import type { Artifact } from '../../types'

export interface AudioLine { speaker: 'A' | 'B'; text: string }

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value
    }
    return ''
}

function stripCodeFence(text: string): string {
    return text
        .replace(/^\s*```(?:json|markdown|md)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
}

function parseJsonLike(value: string): unknown | null {
    const cleaned = stripCodeFence(value)
    const start = Math.min(
        ...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((index) => index >= 0),
    )
    if (!Number.isFinite(start)) return null
    const body = cleaned.slice(start)
    try { return JSON.parse(body) } catch { /* try trimmed body below */ }
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
    if (end < 0) return null
    try { return JSON.parse(body.slice(0, end + 1)) } catch { return null }
}

export function getArtifactMarkdown(artifact: Artifact): string {
    if (typeof artifact.data === 'string') return stripCodeFence(artifact.data)
    const data = asRecord(artifact.data)
    return stripCodeFence(firstString(
        data?.markdown,
        data?.content,
        data?.text,
        data?.report,
        data?.body,
    ))
}

export function getMindMapMarkdown(artifact: Artifact): string {
    const data = asRecord(artifact.data)
    const markdown = normalizeMindMapMarkdown(firstString(data?.markdown, data?.content, data?.text), artifact.title)
    if (markdown) return markdown

    const treeCandidates = [data?.tree, data?.root, data?.nodes, data?.mindmap, artifact.data]
    for (const candidate of treeCandidates) {
        const fromTree = mindMapTreeToMarkdown(candidate)
        if (fromTree) return fromTree
    }
    return ''
}

export function normalizeMindMapMarkdown(value: unknown, fallbackTitle = '思维导图'): string {
    if (typeof value !== 'string') return mindMapTreeToMarkdown(value)

    const cleaned = stripCodeFence(value)
    if (!cleaned) return ''

    const parsed = parseJsonLike(cleaned)
    const fromTree = mindMapTreeToMarkdown(parsed)
    if (fromTree) return fromTree

    if (/^#{1,6}\s+\S/m.test(cleaned)) return cleaned

    const lines = cleaned
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    if (lines.some((line) => /^[-*+]\s+\S/.test(line) || /^\d+[.)]\s+\S/.test(line))) {
        return [`# ${fallbackTitle || '思维导图'}`, ...lines].join('\n')
    }

    return [
        `# ${fallbackTitle || '思维导图'}`,
        ...lines.slice(0, 12).map((line) => `## ${stripListMarker(line)}`),
    ].join('\n')
}

function stripListMarker(line: string): string {
    return line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
}

function mindMapTreeToMarkdown(value: unknown, depth = 1): string {
    if (!value) return ''
    if (typeof value === 'string') return normalizeMindMapMarkdown(value)

    if (Array.isArray(value)) {
        return value
            .map((item) => mindMapTreeToMarkdown(item, depth))
            .filter(Boolean)
            .join('\n')
    }

    const node = asRecord(value)
    if (!node) return ''

    const label = firstString(node.label, node.title, node.name, node.text, node.topic)
    const children = [node.children, node.items, node.nodes, node.branches]
        .find((candidate) => Array.isArray(candidate)) as unknown[] | undefined

    const lines: string[] = []
    if (label) lines.push(`${'#'.repeat(Math.min(depth, 6))} ${label}`)
    const childDepth = label ? depth + 1 : depth
    for (const child of children ?? []) {
        const childMarkdown = mindMapTreeToMarkdown(child, childDepth)
        if (childMarkdown) lines.push(childMarkdown)
    }
    return lines.join('\n')
}

export function getAudioScript(artifact: Artifact): AudioLine[] {
    if (typeof artifact.data === 'string') return parseAudioScript(artifact.data)
    const data = asRecord(artifact.data)
    const candidates = [data?.script, data?.segments, data?.lines, data?.dialogue, data?.transcript]
    for (const candidate of candidates) {
        const parsed = parseAudioScript(candidate)
        if (parsed.length) return parsed
    }
    return []
}

function parseAudioScript(value: unknown): AudioLine[] {
    if (!value) return []

    if (typeof value === 'string') {
        const cleaned = stripCodeFence(value)
        const parsed = parseJsonLike(cleaned)
        const fromJson = parseAudioScript(parsed)
        if (fromJson.length) return fromJson

        return cleaned
            .split(/\n{1,2}/)
            .map((line, index) => parseAudioLineString(line, index))
            .filter((line): line is AudioLine => !!line)
    }

    if (!Array.isArray(value)) return []

    return value
        .map((line, index) => {
            if (typeof line === 'string') return parseAudioLineString(line, index)
            const item = asRecord(line)
            if (!item) return null
            const text = firstString(item.text, item.content, item.line, item.message, item.dialogue)
            if (!text) return null
            return { speaker: normalizeSpeaker(firstString(item.speaker, item.role, item.name), index), text: text.trim() }
        })
        .filter((line): line is AudioLine => !!line)
}

function parseAudioLineString(line: string, index: number): AudioLine | null {
    const cleaned = line.trim()
    if (!cleaned) return null
    const match = cleaned.match(/^(A|B|主持人|专家|嘉宾|Host|Guest|Speaker\s*[AB]?|角色\s*[AB]?)[：:]\s*(.+)$/i)
    if (match) {
        return { speaker: normalizeSpeaker(match[1], index), text: match[2].trim() }
    }
    return { speaker: normalizeSpeaker('', index), text: cleaned }
}

function normalizeSpeaker(value: string, index: number): 'A' | 'B' {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'b' || normalized.includes('guest') || normalized.includes('专家') || normalized.includes('嘉宾')) return 'B'
    if (normalized === 'a' || normalized.includes('host') || normalized.includes('主持')) return 'A'
    return index % 2 === 0 ? 'A' : 'B'
}

export function getAudioDurationSeconds(artifact: Artifact, script = getAudioScript(artifact)): number {
    const data = asRecord(artifact.data)
    const explicit = parseDurationSeconds(data?.durationSeconds)
        ?? parseDurationSeconds(data?.durationSec)
        ?? parseDurationSeconds(data?.duration)
        ?? parseDurationMinutes(data?.durationMinutes)
    if (explicit && explicit > 0) return explicit

    const chars = script.reduce((total, line) => total + line.text.trim().length, 0)
    if (chars <= 0) return 0
    return Math.max(60, Math.ceil((chars / 260) * 60))
}

function parseDurationSeconds(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const clock = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (clock) {
        const first = Number(clock[1])
        const second = Number(clock[2])
        const third = clock[3] ? Number(clock[3]) : 0
        return clock[3] ? first * 3600 + second * 60 + third : first * 60 + second
    }
    const numeric = Number(trimmed.replace(/秒|s(ec)?\.?$/i, ''))
    return Number.isFinite(numeric) ? Math.round(numeric) : null
}

function parseDurationMinutes(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 60)
    if (typeof value !== 'string') return null
    const numeric = Number(value.trim().replace(/分钟|min(ute)?s?\.?$/i, ''))
    return Number.isFinite(numeric) ? Math.round(numeric * 60) : null
}

export function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '暂无时长'
    if (seconds < 60) return `${seconds} 秒`
    const minutes = Math.max(1, Math.round(seconds / 60))
    if (minutes < 60) return `约 ${minutes} 分钟`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`
}