import React from 'react'
import { createPortal } from 'react-dom'
import { Send, Square, CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown, ImagePlus, X, Download, Paperclip, FileText, FileSpreadsheet, File as FileIcon, Volume2, ShieldCheck, ShieldOff, Search } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import {
    streamChat,
    fetchPreferences,
    fetchMessages,
    uploadFiles,
    confirmTool,
    fetchToolResult,
    cancelRun,
    fetchToolApprovals,
    deleteToolApproval as deleteToolApprovalApi,
    type ToolApprovalRule,
} from '../api'
import { t } from '../i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { ActivityItem, AgentTodoItem, FileAttachment, Message, MessagePart } from '../types'
import { CodeBlock, InlineCode } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import { toast } from './Toast'
import { confirm as confirmDialog } from './ConfirmDialog'
import { ProjectPicker } from './ProjectPicker'

function activityPreviewText(item: ActivityItem): string {
    if (typeof item.args?.command === 'string') return item.args.command
    if (item.type === 'tool_result') return item.result ?? ''
    return item.args ? JSON.stringify(item.args) : ''
}

function compactPreview(text: string, max = 96): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

type ActivityDisplayItem = {
    item: ActivityItem
    resultItem?: ActivityItem
}

type RenderPart =
    | { type: 'text'; content: string }
    | { type: 'activity'; item: ActivityItem; resultItem?: ActivityItem }

function canMergeActivityItems(current: ActivityItem, next: ActivityItem): boolean {
    if (next.type !== 'tool_result') return false
    if (current.type !== 'tool_call' && current.type !== 'tool_confirm') return false
    if (current.toolName !== next.toolName) return false
    return true
}

function mergeActivityItems(items: ActivityItem[]): ActivityDisplayItem[] {
    const merged: ActivityDisplayItem[] = []
    for (const item of items) {
        const last = merged[merged.length - 1]
        if (last && !last.resultItem && canMergeActivityItems(last.item, item)) {
            last.resultItem = item
            continue
        }
        merged.push({ item })
    }
    return merged
}

function mergeMessageParts(parts: MessagePart[]): RenderPart[] {
    // Coalesce all text parts into a single trailing text block to match the
    // shape produced by /api/messages on refresh. Streaming may interleave
    // text and activity items, which causes partial markdown (e.g. unclosed
    // code fences) to render incorrectly when split across multiple <MD>
    // blocks. Keeping a single text block downstream of activities ensures
    // the markdown renderer always sees the full document.
    const merged: RenderPart[] = []
    let combinedText = ''
    for (const part of parts) {
        if (part.type === 'text') {
            combinedText += part.content
            continue
        }
        const last = merged[merged.length - 1]
        if (last?.type === 'activity' && !last.resultItem && canMergeActivityItems(last.item, part.item)) {
            last.resultItem = part.item
            continue
        }
        merged.push({ type: 'activity', item: part.item })
    }
    if (combinedText) merged.push({ type: 'text', content: combinedText })
    return merged
}

function compactActivityStatus(item: ActivityItem): string {
    if (item.type === 'tool_result') {
        return item.result?.startsWith('[BLOCKED]') ? t('toolStatusCompactBlocked') : t('toolStatusCompactDone')
    }
    if (item.type !== 'tool_confirm') return ''
    switch (item.confirmStatus) {
        case 'pending':
            return t('toolStatusCompactPending')
        case 'submitted':
        case 'approved':
            return t('toolStatusCompactRunning')
        case 'denied':
            return t('toolStatusCompactDenied')
        case 'expired':
            return t('toolStatusCompactExpired')
        case 'cancelled':
            return t('toolStatusCompactCancelled')
        default:
            return ''
    }
}

// ── Export chat as Markdown ───────────────────────────────────────────────────

const MAX_EXPORT_FILENAME_LENGTH = 50

function exportChatAsMarkdown(title: string, messages: Message[]) {
    const lines = [`# ${title}\n`]
    for (const msg of messages) {
        const role = msg.role === 'user' ? t('you') : t('neo')
        lines.push(`### ${role}\n`)
        if (msg.content) lines.push(msg.content + '\n')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '_').slice(0, MAX_EXPORT_FILENAME_LENGTH)}.md`
    a.click()
    URL.revokeObjectURL(url)
}

// ── Text-to-speech ────────────────────────────────────────────────────────────

function stripMarkdownForSpeech(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '') // code blocks
        .replace(/`[^`]+`/g, '')        // inline code
        .replace(/#{1,6}\s+/g, '')      // headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
        .replace(/\*([^*]+)\*/g, '$1') // italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/^[-*+]\s+/gm, '')    // unordered list
        .replace(/^\d+\.\s+/gm, '')    // ordered list
        .replace(/\n{2,}/g, ' ')
        .trim()
}

/** Heuristic: pick a BCP-47 lang based on dominant script in the text. */
function detectSpeechLang(text: string): string {
    const han = (text.match(/\p{Script=Han}/gu) || []).length
    const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length
    const hangul = (text.match(/\p{Script=Hangul}/gu) || []).length
    const latin = (text.match(/[A-Za-z]/g) || []).length
    const max = Math.max(han, kana, hangul, latin)
    if (max === 0) return (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    if (max === kana) return 'ja-JP'
    if (max === hangul) return 'ko-KR'
    if (max === han) return 'zh-CN'
    return 'en-US'
}

/** Pick the best matching voice for the given BCP-47 lang.
 *  Prefers neural / premium voices when the platform exposes them
 *  (e.g. macOS/iOS Siri, Chrome's Google voices, Edge's Natural voices). */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return undefined
    const lower = lang.toLowerCase()
    const prefix = lower.split('-')[0]

    const matchesLang = (v: SpeechSynthesisVoice) => {
        const vl = v.lang.toLowerCase()
        return vl === lower || vl.startsWith(prefix + '-') || vl.startsWith(prefix)
    }

    const candidates = voices.filter(matchesLang)
    if (!candidates.length) return undefined

    // Score voices by quality hints in their name. Higher is better.
    const score = (v: SpeechSynthesisVoice): number => {
        const name = v.name.toLowerCase()
        let s = 0
        if (/siri/.test(name)) s += 100
        if (/neural|natural/.test(name)) s += 80
        if (/premium|enhanced|hd/.test(name)) s += 60
        if (/google/.test(name)) s += 40 // Chrome's online Google voices are decent
        if (/online/.test(name)) s += 10
        if (/compact|novelty|whisper|bad|eloquence/.test(name)) s -= 50
        // Prefer exact lang match over prefix match.
        const vl = v.lang.toLowerCase()
        if (vl === lower) s += 5
        else if (vl.startsWith(prefix + '-')) s += 2
        // Some platforms mark higher-quality voices as non-default; ignore default flag.
        return s
    }

    return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

function speakText(text: string, onEnd?: () => void) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        onEnd?.()
        return
    }
    window.speechSynthesis.cancel()
    const plain = stripMarkdownForSpeech(text)
    if (!plain) {
        onEnd?.()
        return
    }
    const speak = () => {
        const utt = new SpeechSynthesisUtterance(plain)
        const lang = detectSpeechLang(plain)
        utt.lang = lang
        const voice = pickVoice(lang)
        if (voice) utt.voice = voice
        utt.onend = () => onEnd?.()
        utt.onerror = () => onEnd?.()
        window.speechSynthesis.speak(utt)
    }
    // Voices may load asynchronously on first call; wait once if needed.
    if (window.speechSynthesis.getVoices().length === 0) {
        const handler = () => {
            window.speechSynthesis.removeEventListener('voiceschanged', handler)
            speak()
        }
        window.speechSynthesis.addEventListener('voiceschanged', handler)
        // Fallback in case the event never fires.
        setTimeout(() => {
            window.speechSynthesis.removeEventListener('voiceschanged', handler)
            speak()
        }, 250)
        return
    }
    speak()
}

function SpeakButton({ text }: { text: string }) {
    const [isSpeaking, setIsSpeaking] = React.useState(false)

    React.useEffect(() => {
        return () => {
            if (isSpeaking && typeof window !== 'undefined') {
                window.speechSynthesis?.cancel()
            }
        }
    }, [isSpeaking])

    if (typeof window === 'undefined' || !window.speechSynthesis) return null
    if (!stripMarkdownForSpeech(text)) return null

    const handleClick = () => {
        if (isSpeaking) {
            window.speechSynthesis.cancel()
            setIsSpeaking(false)
            return
        }
        setIsSpeaking(true)
        speakText(text, () => setIsSpeaking(false))
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                'mt-2 inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer',
                isSpeaking
                    ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
            )}
            title={isSpeaking ? t('stopSpeaking') : t('speakMessage')}
            aria-label={isSpeaking ? t('stopSpeaking') : t('speakMessage')}
        >
            {isSpeaking ? <Square size={13} /> : <Volume2 size={13} />}
        </button>
    )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

const markdownComponents: import('react-markdown').Components = {
    pre({ children }) {
        return <>{children}</>
    },
    code({ className, children, ...rest }) {
        const match = /language-(\w+)/.exec(className || '')
        const text = String(children).replace(/\n$/, '')

        // Mermaid diagrams — render as SVG
        if (match?.[1] === 'mermaid') {
            return <MermaidBlock>{text}</MermaidBlock>
        }

        // Block code (inside pre) — detect by the presence of language class or multiline content
        if (match || text.includes('\n')) {
            return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
        }

        // Inline code
        return <InlineCode {...rest}>{children}</InlineCode>
    },
}

const MD: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none">
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={markdownComponents}
        >
            {content}
        </ReactMarkdown>
    </div>
)

// ── Skeleton loading ──────────────────────────────────────────────────────────

const MessageSkeleton: React.FC = () => (
    <div className="space-y-3 animate-fade-in">
        <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2.5">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-4 w-5/6" />
            </div>
        </div>
    </div>
)

// ── Typing indicator ──────────────────────────────────────────────────────────

const TypingIndicator: React.FC = () => (
    <div className="mb-3 rounded-2xl border border-border bg-fill-secondary/60 p-4 backdrop-blur-sm"
         style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
            </div>
            <span className="text-xs text-text-tertiary ml-1">{t('thinking')}</span>
        </div>
    </div>
)

// ── Ask-user card ─────────────────────────────────────────────────────────────

const AskUserCard: React.FC<{ item: ActivityItem }> = ({ item }) => {
    const setPendingQuickReply = useAppStore(s => s.setPendingQuickReply)
    const isGenerating = useAppStore(s => s.isGenerating)

    const question = typeof item.args?.question === 'string' ? item.args.question : ''
    const context = typeof item.args?.context === 'string' ? item.args.context : ''
    const options: string[] = React.useMemo(() => {
        if (!item.args?.options) return []
        try {
            const parsed = JSON.parse(String(item.args.options))
            return Array.isArray(parsed) ? parsed.map(String) : []
        } catch {
            return []
        }
    }, [item.args?.options])

    const handleSelect = (option: string) => {
        if (isGenerating) return
        setPendingQuickReply(option)
    }

    return (
        <div className="my-3 rounded-2xl border border-primary-mint/30 bg-primary-mint/5 px-4 py-3.5"
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            {context && (
                <p className="text-xs text-text-tertiary mb-2 leading-relaxed">{context}</p>
            )}
            <p className="text-sm font-medium text-text leading-relaxed mb-3">❓ {question}</p>
            {options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {options.map((opt, i) => (
                        <button
                            key={i}
                            type="button"
                            disabled={isGenerating}
                            onClick={() => handleSelect(opt)}
                            className={cn(
                                'px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-150',
                                isGenerating
                                    ? 'border-border text-text-tertiary cursor-not-allowed opacity-50'
                                    : 'border-primary-mint/40 text-primary-mint bg-primary-mint/8 hover:bg-primary-mint/15 hover:border-primary-mint/60 cursor-pointer active:scale-95'
                            )}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Activity panel (live tool call log) ───────────────────────────────────────

const ActivityItemCard: React.FC<{ item: ActivityItem; resultItem?: ActivityItem; sessionId?: string | null }> = ({ item, resultItem, sessionId }) => {
    const [expandedResult, setExpandedResult] = React.useState<string | null>(null)
    const [expanding, setExpanding] = React.useState(false)
    const [showDetails, setShowDetails] = React.useState(false)
    const updateActivityConfirmStatus = useAppStore(s => s.updateActivityConfirmStatus)
    const status = item.type === 'tool_confirm' ? (item.confirmStatus ?? 'pending') : undefined
    const targetResult = resultItem ?? (item.type === 'tool_result' ? item : undefined)
    const inputText = item.type === 'tool_result' ? '' : activityPreviewText(item)
    const outputText = targetResult ? (expandedResult ?? targetResult.result ?? '') : ''
    const detailText = [inputText, outputText].filter(Boolean).join('\n\n')
    const preview = compactPreview(inputText || outputText, 120)
    const needsDetails = Boolean(detailText)
    const statusText = targetResult
        ? compactActivityStatus(targetResult)
        : compactActivityStatus(item)
    const tone = status === 'pending'
        ? 'border-warning/30 bg-warning/5'
        : targetResult?.result?.startsWith('[BLOCKED]') || status === 'denied'
            ? 'border-warning/20 bg-warning/5'
            : 'border-border/70 bg-fill-secondary/35'
    const icon = status === 'pending'
        ? '⚠'
        : targetResult || item.type === 'tool_result' || status === 'approved'
            ? '✓'
            : '↳'
    const iconTone = status === 'pending'
        ? 'text-warning'
        : targetResult?.result?.startsWith('[BLOCKED]') || status === 'denied'
            ? 'text-warning'
            : targetResult || item.type === 'tool_result' || status === 'approved'
                ? 'text-success'
                : 'text-primary-mint'

    const handleConfirm = async (confirmId: string, approved: boolean, approvalScope: 'once' | 'session' | 'always' = 'once') => {
        if (!sessionId) return
        // Optimistic UI update, then call server.
        updateActivityConfirmStatus(
            sessionId,
            confirmId,
            approved ? 'submitted' : 'denied',
            approved ? approvalScope : undefined,
        )
        try {
            const target = item.type === 'tool_confirm' && item.confirmId === confirmId ? item : undefined
            await confirmTool({
                approved,
                confirmId,
                runId: target?.runId,
                actionId: target?.actionId,
                ...(approved ? { approvalScope } : {}),
            })
        } catch {
            // Silently ignore — server will time out and auto-deny anyway.
        }
    }

    const handleExpand = async (resultId: string) => {
        if (expandedResult || expanding) return
        setExpanding(true)
        try {
            const full = await fetchToolResult(resultId)
            setExpandedResult(full.result)
        } catch {
            // Leave truncated view in place on error.
        } finally {
            setExpanding(false)
        }
    }

    const toggleDetails = () => {
        const next = !showDetails
        setShowDetails(next)
        if (next && targetResult?.truncated && targetResult.resultId && !expandedResult && !expanding) {
            void handleExpand(targetResult.resultId)
        }
    }

    if (item.type === 'tool_call' && item.toolName === 'ask_user') {
        // Only render the interactive card when there are option chips to click.
        // Without options, fall through to the normal compact tool card so the
        // LLM's markdown relay of the question isn't duplicated.
        let askOptions: string[] = []
        try {
            const parsed = JSON.parse(String(item.args?.options ?? '[]'))
            if (Array.isArray(parsed)) askOptions = parsed.map(String)
        } catch { /* ignore */ }
        if (askOptions.length > 0) return <AskUserCard item={item} />
    }

    if (item.type === 'tool_confirm') {
        return (
            <div className={cn('group my-2 rounded-xl px-3 py-2 text-xs', tone)}
                 style={{ boxShadow: 'var(--shadow-soft)' }}>
                <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('shrink-0 text-[11px]', iconTone)}>{icon}</span>
                    <span className="font-medium text-text-secondary shrink-0">{item.toolName}</span>
                    {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                    {statusText && <span className="shrink-0 text-[11px] text-text-tertiary">{statusText}</span>}
                    {needsDetails && (
                        <button
                            type="button"
                            onClick={toggleDetails}
                            className={cn(
                                'shrink-0 text-[11px] text-text-quaternary hover:text-text-secondary transition-opacity',
                                showDetails ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                            )}
                        >
                            {t('toolDetails')}
                        </button>
                    )}
                </div>
                {status === 'pending' ? (
                    <div className="flex flex-wrap gap-2 pt-2.5 pl-5">
                                <button
                                    type="button"
                                    onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'once')}
                                    className="px-2.5 py-1 text-[11px] rounded-lg bg-primary-mint text-white hover:opacity-90 transition"
                                >
                                    {t('toolApproveOnce')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'session')}
                                    className="px-2.5 py-1 text-[11px] rounded-lg bg-fill-tertiary text-text-secondary hover:bg-fill-quaternary transition"
                                >
                                    {t('toolApproveSession')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'always')}
                                    className="px-2.5 py-1 text-[11px] rounded-lg bg-fill-tertiary text-text-secondary hover:bg-fill-quaternary transition"
                                >
                                    {t('toolApproveAlways')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => item.confirmId && handleConfirm(item.confirmId, false)}
                                    className="px-2.5 py-1 text-[11px] rounded-lg bg-transparent border border-border text-text-secondary hover:bg-fill transition"
                                >
                                    {t('toolDeny')}
                                </button>
                    </div>
                ) : null}
                {showDetails && needsDetails && (
                    <div className="mt-2 pl-5 border-l border-border/60 font-mono text-text-tertiary whitespace-pre-wrap break-words">
                        {detailText}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className={cn('group my-2 rounded-xl px-3 py-2 text-xs', tone)}
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-center gap-2 min-w-0">
                <span className={cn('shrink-0 text-[10px]', iconTone)}>{icon}</span>
                <span className="font-medium text-text-secondary shrink-0">{item.toolName}</span>
                {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                {statusText && <span className="shrink-0 text-[11px] text-text-tertiary">{statusText}</span>}
                {needsDetails && (
                    <button
                        type="button"
                        onClick={toggleDetails}
                        className={cn(
                            'shrink-0 text-[11px] text-text-quaternary hover:text-text-secondary transition-opacity',
                            showDetails ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                        )}
                    >
                        {t('toolDetails')}
                    </button>
                )}
            </div>
            {showDetails && needsDetails && (
                <div className="mt-2 pl-5 border-l border-border/60 font-mono text-text-tertiary whitespace-pre-wrap break-words">
                    {detailText}
                </div>
            )}
        </div>
    )
}

const ActivityFeed: React.FC<{ items: ActivityItem[]; sessionId?: string | null }> = ({ items, sessionId }) => (
    <div className="mb-3">
        {mergeActivityItems(items).map(({ item, resultItem }, idx) => (
            <ActivityItemCard
                key={`${item.type}-${item.confirmId ?? item.resultId ?? item.timestamp}-${resultItem?.resultId ?? 'none'}-${idx}`}
                item={item}
                resultItem={resultItem}
                sessionId={sessionId}
            />
        ))}
    </div>
)

// ── Todo panel (inline progress tracker) ──────────────────────────────────────

const TodoIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'completed':
            return <CheckCircle2 size={14} className="text-success shrink-0" />
        case 'in-progress':
            return <Loader2 size={14} className="text-primary-mint shrink-0 animate-spin" />
        default:
            return <Circle size={14} className="text-text-quaternary shrink-0" />
    }
}

const TodoPanel: React.FC<{ todos: AgentTodoItem[] }> = ({ todos }) => {
    const completed = todos.filter(t => t.status === 'completed').length
    const total = todos.length
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0

    return (
        <div className="my-3 rounded-2xl border border-border bg-fill-secondary/60 overflow-hidden backdrop-blur-sm"
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            {/* Header with progress bar */}
            <div className="px-4 py-2.5 flex items-center gap-2.5 text-xs text-text-secondary">
                <span className="font-semibold">{t('tasks')}</span>
                <span className="text-text-tertiary">{completed}/{total}</span>
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-primary-mint to-emerald-500 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            </div>
            {/* Task list */}
            <div className="px-4 pb-3 space-y-1">
                {todos.map((t) => (
                    <div
                        key={t.id}
                        className={cn(
                            'flex items-center gap-2.5 py-1 text-xs transition-all duration-300',
                            t.status === 'completed' ? 'text-text-tertiary line-through opacity-60' : 'text-text'
                        )}
                    >
                        <TodoIcon status={t.status} />
                        <span>{t.title}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

const ToolApprovalBadge: React.FC<{
    scope: ToolApprovalRule['scope']
    currentSessionId?: string | null
    ruleSessionId?: string
}> = ({ scope, currentSessionId, ruleSessionId }) => {
    const label = scope === 'always'
        ? t('toolApprovalScopeAlways')
        : ruleSessionId && currentSessionId && ruleSessionId === currentSessionId
            ? t('toolApprovalScopeCurrentChat')
            : t('toolApprovalScopeSession')
    const tone = scope === 'always'
        ? 'bg-primary-mint/10 text-primary-mint border-primary-mint/20'
        : 'bg-fill-tertiary text-text-secondary border-border'

    return (
        <span className={cn('px-2 py-0.5 rounded-full border text-[10px] font-medium', tone)}>
            {label}
        </span>
    )
}

const ToolApprovalsModal: React.FC<{
    open: boolean
    onClose: () => void
    currentSessionId?: string | null
}> = ({ open, onClose, currentSessionId }) => {
    const [rules, setRules] = React.useState<ToolApprovalRule[]>([])
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [deletingRuleId, setDeletingRuleId] = React.useState<string | null>(null)

    const loadRules = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetchToolApprovals()
            setRules(res.rules)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('loadToolApprovalsFailed'))
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        if (!open) return
        void loadRules()
    }, [open, loadRules])

    React.useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [open, onClose])

    const handleDelete = async (rule: ToolApprovalRule) => {
        const description = compactPreview(
            typeof rule.args?.command === 'string'
                ? rule.args.command
                : JSON.stringify(rule.args ?? {}),
            160,
        )
        const ok = await confirmDialog(t('removeToolApprovalConfirm'), {
            description,
            confirmText: t('delete'),
            cancelText: t('cancel'),
            destructive: true,
        })
        if (!ok) return

        setDeletingRuleId(rule.id)
        try {
            await deleteToolApprovalApi(rule.id)
            setRules((prev) => prev.filter((entry) => entry.id !== rule.id))
            toast.success(t('removeToolApprovalSuccess'))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('removeToolApprovalFailed'))
        } finally {
            setDeletingRuleId(null)
        }
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 animate-fade-in" onClick={onClose}>
            <div
                className="bg-bg-container rounded-2xl shadow-2xl w-[720px] max-w-[94vw] max-h-[78vh] overflow-hidden animate-slide-up"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-text">{t('toolApprovalsTitle')}</h3>
                        <p className="text-xs text-text-tertiary mt-1">{t('toolApprovalsSubtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-colors"
                        title={t('close')}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto custom-scrollbar max-h-[calc(78vh-72px)]">
                    {loading ? (
                        <div className="flex items-center gap-2 text-sm text-text-tertiary">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{t('toolApprovalsLoading')}</span>
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            {t('loadToolApprovalsFailed')}: {error}
                        </div>
                    ) : rules.length === 0 ? (
                        <div className="rounded-xl border border-border bg-fill-secondary/40 px-4 py-6 text-center text-sm text-text-tertiary">
                            {t('toolApprovalsEmpty')}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {rules.map((rule) => {
                                const preview = compactPreview(
                                    typeof rule.args?.command === 'string'
                                        ? rule.args.command
                                        : JSON.stringify(rule.args ?? {}),
                                    180,
                                )
                                return (
                                    <div key={rule.id} className="rounded-2xl border border-border bg-fill-secondary/35 px-4 py-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                        <div className="flex items-start gap-3 justify-between">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-semibold text-text">{rule.toolName}</span>
                                                    <ToolApprovalBadge scope={rule.scope} currentSessionId={currentSessionId} ruleSessionId={rule.sessionId} />
                                                </div>
                                                {preview && (
                                                    <div className="mt-2 font-mono text-xs text-text-secondary whitespace-pre-wrap break-words">
                                                        {preview}
                                                    </div>
                                                )}
                                                <div className="mt-2 text-[11px] text-text-tertiary flex flex-wrap gap-x-3 gap-y-1">
                                                    <span>{t('toolApprovalUpdatedAt')}: {new Date(rule.updatedAt).toLocaleString()}</span>
                                                    {rule.scope === 'session' && rule.sessionId && rule.sessionId !== currentSessionId && (
                                                        <span>{t('toolApprovalChatLabel')}: {rule.sessionId}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleDelete(rule)}
                                                disabled={deletingRuleId === rule.id}
                                                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors disabled:opacity-60"
                                            >
                                                {deletingRuleId === rule.id ? t('deleting') : t('removeToolApproval')}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Scroll to bottom button ───────────────────────────────────────────────────

const ScrollToBottom: React.FC<{ onClick: () => void; visible: boolean }> = ({ onClick, visible }) => (
    <button
        onClick={onClick}
        className={cn(
            'absolute bottom-28 right-6 z-10 w-9 h-9 rounded-full bg-bg-container border border-border flex items-center justify-center transition-all duration-300',
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
        style={{ boxShadow: 'var(--shadow-elevated)' }}
    >
        <ChevronDown size={16} className="text-text-secondary" />
    </button>
)

// ── File attachment helper ────────────────────────────────────────────────────

const FileAttachmentIcon: React.FC<{ filename: string; className?: string }> = ({ filename, className }) => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'pdf') return <FileText size={14} className={className ?? 'text-red-400'} />
    if (ext === 'docx' || ext === 'doc') return <FileText size={14} className={className ?? 'text-blue-400'} />
    if (ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet size={14} className={className ?? 'text-green-400'} />
    return <FileIcon size={14} className={className ?? 'text-text-tertiary'} />
}

const COMMON_MODEL_ALIASES = ['flash', 'pro', 'deepseek', 'gemma', 'gemini-acp']

const MODEL_PRESENTATION: Record<string, { label: string; badge?: string }> = {
    flash: { label: 'Gemini Flash', badge: 'Google' },
    pro: { label: 'Gemini Pro', badge: 'Google' },
    deepseek: { label: 'DeepSeek Chat', badge: 'DeepSeek' },
    'deepseek-chat': { label: 'DeepSeek Chat', badge: 'DeepSeek' },
    'deepseek-reasoner': { label: 'DeepSeek Reasoner', badge: 'DeepSeek' },
    gemma: { label: 'Gemma', badge: 'Local' },
    'gemini-acp': { label: 'Gemini CLI', badge: 'CLI' },
    gpt: { label: 'GPT-4o', badge: 'OpenAI' },
    'gpt-4o': { label: 'GPT-4o', badge: 'OpenAI' },
    'gpt-4o-mini': { label: 'GPT-4o mini', badge: 'OpenAI' },
    'gpt-5': { label: 'GPT-5', badge: 'OpenAI' },
    'gpt-5-mini': { label: 'GPT-5 mini', badge: 'OpenAI' },
    claude: { label: 'Claude Sonnet', badge: 'Anthropic' },
    'claude-sonnet': { label: 'Claude Sonnet', badge: 'Anthropic' },
    'claude-opus': { label: 'Claude Opus', badge: 'Anthropic' },
    'claude-haiku': { label: 'Claude Haiku', badge: 'Anthropic' },
}

function titleizeAlias(alias: string): string {
    return alias
        .split('-')
        .map((part) => {
            if (!part) return part
            if (/^\d/.test(part)) return part.toUpperCase()
            return part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`
        })
        .join(' ')
}

function inferModelBadge(alias: string): string | undefined {
    if (alias === 'gemma') return 'Local'
    if (alias === 'gemini-acp') return 'CLI'
    if (alias === 'flash' || alias === 'pro' || alias.startsWith('gemini-')) return 'Google'
    if (alias === 'deepseek' || alias.startsWith('deepseek-')) return 'DeepSeek'
    if (alias === 'gpt' || alias.startsWith('gpt-')) return 'OpenAI'
    if (alias === 'claude' || alias.startsWith('claude-')) return 'Anthropic'
    return undefined
}

function getModelPresentation(alias: string): { label: string; subtitle: string; badge?: string } {
    if (alias === 'auto') {
        return { label: 'Auto', subtitle: t('smartRouting') }
    }
    const preset = MODEL_PRESENTATION[alias]
    return {
        label: preset?.label ?? titleizeAlias(alias),
        subtitle: alias,
        badge: preset?.badge ?? inferModelBadge(alias),
    }
}

type ModelPickerProps = {
    selectedModel: string
    onSelect: (model: string) => void
    availableModels: string[]
}

const ModelPicker: React.FC<ModelPickerProps> = ({ selectedModel, onSelect, availableModels }) => {
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const panelRef = React.useRef<HTMLDivElement>(null)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [showOtherModels, setShowOtherModels] = React.useState(false)
    const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({})

    const commonModels = React.useMemo(() => {
        const set = new Set(availableModels)
        return COMMON_MODEL_ALIASES.filter((alias) => set.has(alias))
    }, [availableModels])

    const uncommonModels = React.useMemo(
        () => availableModels.filter((alias) => !COMMON_MODEL_ALIASES.includes(alias)),
        [availableModels],
    )

    const selectedPresentation = React.useMemo(
        () => getModelPresentation(selectedModel === 'auto' ? 'auto' : selectedModel),
        [selectedModel],
    )

    const updatePanelPosition = React.useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        const width = Math.min(272, window.innerWidth - 12)
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
        const bottom = Math.max(10, window.innerHeight - rect.top + 8)
        setPanelStyle({
            position: 'fixed',
            left,
            bottom,
            width,
        })
    }, [])

    React.useEffect(() => {
        if (!open) return
        updatePanelPosition()
        const handleViewportChange = () => updatePanelPosition()
        window.addEventListener('resize', handleViewportChange)
        window.addEventListener('scroll', handleViewportChange, true)
        return () => {
            window.removeEventListener('resize', handleViewportChange)
            window.removeEventListener('scroll', handleViewportChange, true)
        }
    }, [open, updatePanelPosition])

    React.useEffect(() => {
        if (!open) {
            setQuery('')
            return
        }
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node
            if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
            setOpen(false)
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    React.useEffect(() => {
        if (!open) return
        if (selectedModel !== 'auto' && uncommonModels.includes(selectedModel)) {
            setShowOtherModels(true)
        }
        searchRef.current?.focus()
    }, [open, selectedModel, uncommonModels])

    const normalizedQuery = query.trim().toLowerCase()

    const matchesQuery = React.useCallback((alias: string) => {
        if (!normalizedQuery) return true
        const presentation = getModelPresentation(alias)
        return [presentation.label, presentation.subtitle, presentation.badge, alias]
            .filter((value): value is string => typeof value === 'string')
            .some((value) => value.toLowerCase().includes(normalizedQuery))
    }, [normalizedQuery])

    const filteredCommon = commonModels.filter(matchesQuery)
    const filteredOther = uncommonModels.filter(matchesQuery)
    const showExpandedOther = showOtherModels || Boolean(normalizedQuery)
    const hasMatchedModels = filteredCommon.length > 0 || filteredOther.length > 0 || 'auto'.includes(normalizedQuery)

    const renderOption = (alias: string) => {
        const presentation = getModelPresentation(alias)
        const isSelected = selectedModel === alias
        return (
            <button
                key={alias}
                type="button"
                onClick={() => {
                    onSelect(alias)
                    setOpen(false)
                }}
                className={cn(
                    'w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all duration-150 cursor-pointer',
                    isSelected
                        ? 'bg-fill text-text shadow-sm'
                        : 'text-text-secondary hover:bg-fill-secondary/90'
                )}
            >
                <div className="w-3 shrink-0 flex items-center justify-center">
                    {isSelected ? (
                        <CheckCircle2 size={12} className="text-primary-mint" />
                    ) : (
                        <Circle size={9} className="text-text-quaternary" />
                    )}
                </div>
                <div className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px] text-text">
                    {presentation.label}
                </div>
                {presentation.badge && (
                    <span className={cn(
                        'shrink-0 rounded-full border px-1.25 py-0.5 text-[8px] font-medium leading-none',
                        isSelected
                            ? 'border-primary-mint/30 bg-primary-mint/10 text-primary-mint'
                            : 'border-border bg-fill-secondary/70 text-text-tertiary'
                    )}>
                        {presentation.badge}
                    </span>
                )}
            </button>
        )
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((value) => !value)}
                className={cn(
                    'group flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-all duration-150 cursor-pointer shrink-0 min-w-0',
                    open
                        ? 'border-primary-mint/35 bg-fill text-text'
                        : 'border-transparent bg-fill/60 text-text-secondary hover:border-border hover:bg-fill'
                )}
                style={{ boxShadow: open ? 'var(--shadow-soft)' : undefined }}
            >
                <div className="min-w-0 max-w-[112px]">
                    <div className="truncate text-[11px] font-medium leading-4">{selectedPresentation.label}</div>
                </div>
                <ChevronDown size={12} className={cn('shrink-0 transition-transform duration-150', open && 'rotate-180')} />
            </button>

            {open && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="glass z-[120] overflow-hidden rounded-[3px] border border-border bg-bg-elevated/95"
                    style={{ ...panelStyle, boxShadow: 'var(--shadow-float)' }}
                >
                    <div className="border-b border-border/80 px-2 py-2">
                        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-fill-secondary/85 px-2 py-1.5">
                            <Search size={12} className="shrink-0 text-text-quaternary" />
                            <input
                                ref={searchRef}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={t('searchModels')}
                                className="w-full bg-transparent text-[11px] text-text placeholder:text-text-quaternary focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="max-h-[min(48vh,18rem)] overflow-y-auto custom-scrollbar p-1.5">
                        {(!normalizedQuery || 'auto'.includes(normalizedQuery)) && renderOption('auto')}

                        {filteredCommon.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                                {filteredCommon.map((alias) => renderOption(alias))}
                            </div>
                        )}

                        {uncommonModels.length > 0 && (
                            <div className="mt-2 border-t border-border/70 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowOtherModels((value) => !value)}
                                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.25 text-left text-[10px] font-medium text-text-secondary hover:bg-fill-secondary/80 transition-colors cursor-pointer"
                                >
                                    <ChevronRight size={12} className={cn('transition-transform duration-150', showExpandedOther && 'rotate-90')} />
                                    <span>{t('otherModels')}</span>
                                    <span className="ml-auto rounded-full bg-fill px-1.5 py-0.5 text-[9px] text-text-tertiary">{filteredOther.length || uncommonModels.length}</span>
                                </button>

                                {showExpandedOther && filteredOther.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                        {filteredOther.map((alias) => renderOption(alias))}
                                    </div>
                                )}
                            </div>
                        )}

                        {!hasMatchedModels && (
                            <div className="px-3 py-5 text-center text-[11px] text-text-tertiary">
                                {t('noMatchingModels')}
                            </div>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </>
    )
}

// ── Chat input ────────────────────────────────────────────────────────────────

interface PendingDocument {
    filename: string
    text: string
    pageCount?: number
    mimeType?: string
}

const ChatInput: React.FC<{ onOpenToolApprovals: () => void }> = ({ onOpenToolApprovals }) => {
    const {
        inputValue, setInputValue,
        pendingQuickReply, setPendingQuickReply,
        isGenerating, setIsGenerating,
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
        addVideoToLastAssistantMessage,
        updateLastAssistantThinking, updateLastAssistantTodos, appendToLastAssistantActivity, updateActivityConfirmStatus,
        currentRunId, setCurrentRunId, setAbortController, setThinkingStatus,
        selectedModel, setSelectedModel,
        confirmDangerous, setConfirmDangerous,
    } = useAppStore()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const docInputRef = React.useRef<HTMLInputElement>(null)
    const [pendingImages, setPendingImages] = React.useState<string[]>([])
    const [pendingDocs, setPendingDocs] = React.useState<PendingDocument[]>([])
    const [isUploading, setIsUploading] = React.useState(false)
    const [availableModels, setAvailableModels] = React.useState<string[]>([])

    React.useEffect(() => {
        let disposed = false
        const loadAvailableModels = async () => {
            try {
                const res = await fetchPreferences()
                if (disposed) return
                const next = Array.isArray(res.availableModels)
                    ? res.availableModels
                        .filter((m): m is string => typeof m === 'string')
                        .map((m) => m.trim())
                        .filter((m) => Boolean(m) && m !== 'auto')
                    : []
                setAvailableModels([...new Set(next)])
            } catch {
                if (!disposed) setAvailableModels([])
            }
        }
        void loadAvailableModels()
        return () => {
            disposed = true
        }
    }, [])

    React.useEffect(() => {
        if (selectedModel === 'auto') return
        if (availableModels.length === 0) return
        if (!availableModels.includes(selectedModel)) {
            setSelectedModel('auto')
        }
    }, [availableModels, selectedModel, setSelectedModel])

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            if (file.size > 10 * 1024 * 1024) continue // 10MB limit per image
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }
        e.target.value = '' // reset so same file can be re-selected
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files
        if (!fileList) return
        const files = Array.from(fileList).filter(f => f.size <= 20 * 1024 * 1024)
        if (files.length === 0) return

        setIsUploading(true)
        try {
            const results = await uploadFiles(files)
            for (const r of results) {
                if (r.type === 'image') {
                    setPendingImages((prev) => [...prev, r.dataUrl])
                } else if (r.type === 'document') {
                    setPendingDocs((prev) => [...prev, {
                        filename: r.filename,
                        text: r.text,
                        pageCount: r.pageCount,
                        mimeType: r.mimeType,
                    }])
                }
            }
        } catch (err) {
            console.error('File upload failed:', err)
        } finally {
            setIsUploading(false)
            e.target.value = ''
        }
    }

    const removeImage = (idx: number) => {
        setPendingImages((prev) => prev.filter((_, i) => i !== idx))
    }

    const removeDoc = (idx: number) => {
        setPendingDocs((prev) => prev.filter((_, i) => i !== idx))
    }

    const handleSendRef = React.useRef<(overrideText?: string) => Promise<void>>(async () => {})

    const handleSend = async (overrideText?: string) => {
        const text = overrideText ?? inputValue.trim()
        if ((!text && !pendingImages.length && !pendingDocs.length) || !activeChatId || isGenerating) return
        // Cancel any ongoing speech when user sends a new message
        window.speechSynthesis?.cancel()
        const images = pendingImages.length ? [...pendingImages] : undefined
        const documents = pendingDocs.length ? [...pendingDocs] : undefined

        // Build file attachments for the message record
        const fileAttachments: FileAttachment[] = [
            ...(documents?.map(d => ({
                filename: d.filename,
                type: 'document' as const,
                preview: d.text.slice(0, 200),
                pageCount: d.pageCount,
                mimeType: d.mimeType,
            })) ?? []),
        ]

        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'user',
            content: text,
            images,
            files: fileAttachments.length > 0 ? fileAttachments : undefined,
            timestamp: Date.now(),
        })
        setInputValue('')
        setPendingImages([])
        setPendingDocs([])
        setIsGenerating(true)
        setThinkingStatus(t('thinking'))

        // Placeholder for assistant
        addMessage(activeChatId, {
            id: Math.random().toString(36).substring(7),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        })

        const controller = new AbortController()
        setAbortController(controller)
        let accumulated = ''
        let thinkingAccum = ''

        try {
            for await (const chunk of streamChat(
                text, activeChatId, controller.signal, selectedModel, images,
                documents?.map(d => ({ filename: d.filename, text: d.text })),
                confirmDangerous,
            )) {
                if (chunk.type === 'run' && chunk.runId) {
                    setCurrentRunId(chunk.runId)
                    continue
                }
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'thought') {
                    thinkingAccum += chunk.text ?? ''
                } else if (chunk.type === 'tool_call') {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_call',
                        toolName: chunk.toolName ?? 'tool',
                        args: chunk.args,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_result') {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_result',
                        toolName: chunk.toolName ?? 'tool',
                        result: chunk.result,
                        resultId: chunk.resultId,
                        truncated: chunk.truncated,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_confirm' && chunk.confirmId) {
                    appendToLastAssistantActivity(activeChatId, {
                        type: 'tool_confirm',
                        toolName: chunk.toolName ?? 'tool',
                        args: chunk.args,
                        confirmId: chunk.confirmId,
                        runId: chunk.runId,
                        actionId: chunk.actionId,
                        confirmStatus: 'pending',
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'confirm_resolved' && chunk.confirmId && chunk.confirmStatus) {
                    updateActivityConfirmStatus(activeChatId, chunk.confirmId, chunk.confirmStatus, chunk.approvalScope)
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus('')
                    accumulated += chunk.text
                    updateLastAssistantMessage(activeChatId, accumulated)
                } else if (chunk.type === 'image' && chunk.url) {
                    setThinkingStatus('')
                    addImageToLastAssistantMessage(activeChatId, chunk.url)
                } else if (chunk.type === 'video' && chunk.url) {
                    setThinkingStatus('')
                    addVideoToLastAssistantMessage(activeChatId, chunk.url)
                } else if (chunk.type === 'todo_update' && chunk.todos) {
                    updateLastAssistantTodos(activeChatId, chunk.todos as AgentTodoItem[])
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(activeChatId, `⚠️ ${err instanceof Error ? err.message : t('requestFailed')}`)
            }
        } finally {
            if (thinkingAccum) {
                updateLastAssistantThinking(activeChatId, thinkingAccum)
            }
            setIsGenerating(false)
            setCurrentRunId(null)
            setThinkingStatus('')
            setAbortController(null)
        }
    }

    const handleStop = async () => {
        if (currentRunId) {
            try {
                await cancelRun(currentRunId)
                return
            } catch {
                // Fall back to local abort when cancel API is unavailable.
            }
        }
        useAppStore.getState().abortController?.abort()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSend()
        }
        // Escape stops generation
        if (e.key === 'Escape' && isGenerating) {
            e.preventDefault()
            handleStop()
        }
    }

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items
        const imageFiles: File[] = []
        const docFiles: File[] = []

        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault()
                const file = item.getAsFile()
                if (file) imageFiles.push(file)
            } else if (item.kind === 'file') {
                const file = item.getAsFile()
                if (file && !file.type.startsWith('image/')) {
                    e.preventDefault()
                    docFiles.push(file)
                }
            }
        }

        // Handle images inline (as before)
        for (const file of imageFiles) {
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }

        // Handle document files via upload
        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const r of results) {
                    if (r.type === 'image') {
                        setPendingImages((prev) => [...prev, r.dataUrl])
                    } else if (r.type === 'document') {
                        setPendingDocs((prev) => [...prev, {
                            filename: r.filename,
                            text: r.text,
                            pageCount: r.pageCount,
                            mimeType: r.mimeType,
                        }])
                    }
                }
            } catch (err) {
                console.error('Paste file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
        }
    }

    // Drag-and-drop handler
    const [isDragOver, setIsDragOver] = React.useState(false)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)

        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return

        const imageFiles = files.filter(f => f.type.startsWith('image/'))
        const docFiles = files.filter(f => !f.type.startsWith('image/'))

        // Handle images inline
        for (const file of imageFiles) {
            if (file.size > 10 * 1024 * 1024) continue
            const reader = new FileReader()
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setPendingImages((prev) => [...prev, reader.result as string])
                }
            }
            reader.readAsDataURL(file)
        }

        // Handle documents via upload
        if (docFiles.length > 0) {
            setIsUploading(true)
            try {
                const results = await uploadFiles(docFiles)
                for (const r of results) {
                    if (r.type === 'image') {
                        setPendingImages((prev) => [...prev, r.dataUrl])
                    } else if (r.type === 'document') {
                        setPendingDocs((prev) => [...prev, {
                            filename: r.filename,
                            text: r.text,
                            pageCount: r.pageCount,
                            mimeType: r.mimeType,
                        }])
                    }
                }
            } catch (err) {
                console.error('Drop file upload failed:', err)
            } finally {
                setIsUploading(false)
            }
        }
    }

    // Auto-resize textarea
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
        }
    }, [inputValue])

    // Auto-focus when active chat changes
    React.useEffect(() => {
        if (activeChatId && textareaRef.current) {
            textareaRef.current.focus()
        }
    }, [activeChatId])

    // Keep ref up to date so quick-reply effect always calls the latest handleSend
    React.useLayoutEffect(() => { handleSendRef.current = handleSend })

    // Auto-send when user clicks an ask_user option chip
    React.useEffect(() => {
        if (!pendingQuickReply || isGenerating || !activeChatId) return
        const text = pendingQuickReply
        setPendingQuickReply(null)
        void handleSendRef.current(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingQuickReply])

    return (
        <div className="p-3 sm:p-4 bg-bg-container/80 backdrop-blur-xl shrink-0 border-t border-border safe-bottom">
            <div className="max-w-3xl mx-auto min-w-0">
                {/* Attachment previews */}
                {(pendingImages.length > 0 || pendingDocs.length > 0) && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {pendingImages.map((src, i) => (
                            <div key={`img-${i}`} className="relative group">
                                <img src={src} alt="" className="h-16 w-16 object-cover rounded-xl border border-border" />
                                <button
                                    onClick={() => removeImage(i)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-text text-bg-container flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {pendingDocs.map((doc, i) => (
                            <div key={`doc-${i}`} className="relative group flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs">
                                <FileAttachmentIcon filename={doc.filename} />
                                <span className="text-text-secondary max-w-[120px] truncate">{doc.filename}</span>
                                {doc.pageCount && <span className="text-text-quaternary">({doc.pageCount}p)</span>}
                                <button
                                    onClick={() => removeDoc(i)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-text text-bg-container flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                        {isUploading && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs text-text-tertiary">
                                <Loader2 size={14} className="animate-spin" />
                                <span>{t('uploading')}</span>
                            </div>
                        )}
                    </div>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageSelect}
                />
                <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.json,.csv,.xml,.yaml,.yml,.log,.html,.htm,.js,.ts,.py,.sh,.css,.sql"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                />
                <div
                     className={cn(
                         "relative bg-fill-secondary/80 border rounded-2xl focus-within:ring-2 focus-within:ring-primary-mint/30 focus-within:border-primary-mint/40 transition-all duration-200",
                         isDragOver ? 'border-primary-mint border-dashed bg-primary-mint/5' : 'border-border'
                     )}
                     style={{ boxShadow: 'var(--shadow-soft)' }}
                     onDragOver={handleDragOver}
                     onDragLeave={handleDragLeave}
                     onDrop={handleDrop}
                >
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={t('askAnything')}
                        className="w-full bg-transparent px-5 pt-3.5 pb-2 pr-14 focus:outline-none resize-none text-sm leading-relaxed placeholder:text-text-tertiary"
                        rows={1}
                    />
                    {/* Bottom bar: image upload + model selector + send */}
                    <div className="flex items-center justify-between px-3 pb-2.5 gap-2 min-w-0">
                        <div className="flex items-center gap-1 min-w-0 flex-1 mobile-scroll-x">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-all duration-150 shrink-0 cursor-pointer"
                                title={t('uploadImage')}
                                type="button"
                            >
                                <ImagePlus size={16} />
                            </button>
                            <button
                                onClick={() => docInputRef.current?.click()}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-all duration-150 shrink-0 cursor-pointer"
                                title={t('attachFile')}
                                type="button"
                                disabled={isUploading}
                            >
                                <Paperclip size={16} />
                            </button>
                            <button
                                onClick={() => setConfirmDangerous(!confirmDangerous)}
                                className={cn(
                                    'p-1.5 rounded-lg transition-all duration-150 shrink-0 cursor-pointer',
                                    confirmDangerous
                                        ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                                        : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                                )}
                                title={confirmDangerous ? '高危操作需确认：开' : '高危操作需确认：关'}
                                type="button"
                            >
                                {confirmDangerous ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                            </button>
                            <button
                                onClick={onOpenToolApprovals}
                                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-fill/60 text-text-secondary border border-transparent hover:border-border hover:bg-fill transition-all duration-150 cursor-pointer shrink-0"
                                type="button"
                            >
                                {t('manageToolApprovals')}
                            </button>
                            <ModelPicker
                                selectedModel={selectedModel}
                                onSelect={(model) => setSelectedModel(model as typeof selectedModel)}
                                availableModels={availableModels}
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {isGenerating && (
                                <span className="text-[11px] text-text-tertiary hidden sm:inline">
                                    {t('pressEscToStop')}
                                </span>
                            )}
                            {isGenerating ? (
                                <button
                                    onClick={handleStop}
                                    className="p-2 bg-text text-bg-container rounded-xl hover:opacity-80 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
                                    title={t('stopEsc')}
                                >
                                    <Square size={14} fill="currentColor" />
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleSend()}
                                    disabled={!inputValue.trim() && !pendingImages.length && !pendingDocs.length}
                                    className={cn(
                                        'p-2 rounded-xl transition-all duration-200',
                                        !inputValue.trim() && !pendingImages.length && !pendingDocs.length
                                            ? 'bg-fill text-text-tertiary cursor-not-allowed'
                                            : 'bg-gradient-to-r from-primary-mint to-emerald-500 text-white shadow-sm hover:opacity-90 hover:scale-105 active:scale-95 cursor-pointer'
                                    )}
                                    title={t('sendEnter')}
                                >
                                    <Send size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-[10px] text-text-quaternary text-center mt-2 hidden sm:block">
                    <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Enter</kbd> {t('enterToSend')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Shift+Enter</kbd> {t('shiftEnterNewline')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+N</kbd> {t('newChatShortcut')}
                </p>
            </div>
        </div>
    )
}

// ── Chat area ─────────────────────────────────────────────────────────────────

export const ChatArea: React.FC = () => {
    const { chats, activeChatId, messages, isGenerating, thinkingStatus, setMessages } = useAppStore()
    const activeChat = chats.find((c) => c.id === activeChatId)
    const chatMessages = messages[activeChatId ?? ''] ?? []
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [showScrollBtn, setShowScrollBtn] = React.useState(false)
    const [showToolApprovals, setShowToolApprovals] = React.useState(false)

    // Load message history from server when session changes
    React.useEffect(() => {
        if (!activeChatId) return
        // Only load from server if we have no messages in memory yet
        if (messages[activeChatId]?.length) return
        fetchMessages(activeChatId)
            .then((rows) => {
                if (rows.length > 0) {
                    setMessages(activeChatId, rows.map((r) => ({
                        id: r.id,
                        role: r.role as 'user' | 'assistant',
                        content: r.content,
                        activityLog: r.activityLog as ActivityItem[] | undefined,
                        parts: r.parts as MessagePart[] | undefined,
                        timestamp: r.timestamp,
                    })))
                }
            })
            .catch(() => { /* session may not exist yet */ })
    }, [activeChatId])

    // Auto-scroll and track scroll position
    const scrollToBottom = React.useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [])

    React.useEffect(() => {
        if (chatMessages.length > 0) scrollToBottom()
    }, [chatMessages, scrollToBottom])

    const handleScroll = React.useCallback(() => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
        setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120)
    }, [])

    return (
        <div className="flex flex-col h-full bg-bg-container overflow-hidden relative min-w-0">
            {/* Header */}
            <div className="h-11 sm:h-14 flex items-center px-4 sm:px-6 pl-12 md:pl-6 shrink-0 bg-bg-container/80 backdrop-blur-xl relative">
                <span className="absolute left-0 right-0 text-center text-sm font-semibold truncate text-text tracking-tight px-16 pointer-events-none">
                    {activeChat?.title ?? t('welcome')}
                </span>
                {isGenerating && thinkingStatus && (
                    <span className="ml-3 text-xs text-text-tertiary flex items-center gap-1.5 shrink-0">
                        <Loader2 size={11} className="animate-spin text-primary-mint" />
                        <span className="hidden sm:inline">{thinkingStatus}</span>
                    </span>
                )}
                {activeChat && chatMessages.length > 0 && !isGenerating && (
                    <button
                        onClick={() => exportChatAsMarkdown(activeChat.title, chatMessages)}
                        className="ml-2 p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-colors shrink-0 cursor-pointer"
                        title={t('exportMarkdown')}
                    >
                        <Download size={14} />
                    </button>
                )}
                {activeChat && (
                    <div className="ml-auto">
                        <ProjectPicker sessionId={activeChat.id} projectRoot={activeChat.projectRoot ?? null} />
                    </div>
                )}
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-4 py-3 sm:py-8">
                <div className="max-w-3xl mx-auto space-y-5 sm:space-y-7">
                    {chatMessages.length === 0 && <WelcomeScreen />}

                    {chatMessages.map((msg, msgIdx) => (
                        <div
                            key={msg.id}
                            className={cn(
                                'flex flex-col gap-1 w-full animate-slide-up',
                                msg.role === 'user' ? 'items-end' : 'items-start'
                            )}
                            style={{ animationDelay: `${Math.min(msgIdx * 30, 150)}ms` }}
                        >
                            {msg.role === 'user' ? (
                                <div className="max-w-[90%] sm:max-w-[80%]">
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                            {msg.images.map((src, i) => (
                                                <img key={i} src={src} alt="" className="max-h-40 rounded-xl border border-border" style={{ boxShadow: 'var(--shadow-soft)' }} />
                                            ))}
                                        </div>
                                    )}
                                    {msg.files && msg.files.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                            {msg.files.map((f, i) => (
                                                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-fill-secondary/60 text-xs">
                                                    <FileAttachmentIcon filename={f.filename} />
                                                    <span className="text-text-secondary max-w-[150px] truncate">{f.filename}</span>
                                                    {f.pageCount && <span className="text-text-quaternary">({f.pageCount}p)</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {msg.content && (
                                        <div className="px-4 sm:px-5 py-2.5 sm:py-3 bg-user-bubble border border-user-bubble-border rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap break-words"
                                             style={{ boxShadow: 'var(--shadow-soft)', overflowWrap: 'anywhere' }}>
                                            {msg.content}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <details className="mb-3 group">
                                            <summary className="cursor-pointer text-xs text-text-tertiary hover:text-text-secondary select-none flex items-center gap-1.5 py-1">
                                                <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
                                                {t('thinkingLabel')}
                                            </summary>
                                            <div className="mt-2 pl-4 border-l-2 border-border/60 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                                                {msg.thinking}
                                            </div>
                                        </details>
                                    )}
                                    {msg.todos && msg.todos.length > 0 && (
                                        <TodoPanel todos={msg.todos} />
                                    )}
                                    {msg.parts && msg.parts.length > 0 ? (
                                        <div>
                                            {mergeMessageParts(msg.parts).map((part, idx) => part.type === 'text' ? (
                                                <div key={`${msg.id}-text-${idx}`} className="mb-3 last:mb-0">
                                                    <MD content={part.content} />
                                                </div>
                                            ) : (
                                                <ActivityItemCard
                                                    key={`${msg.id}-activity-${part.item.confirmId ?? part.item.resultId ?? part.item.timestamp}-${part.resultItem?.resultId ?? 'none'}-${idx}`}
                                                    item={part.item}
                                                    resultItem={part.resultItem}
                                                    sessionId={activeChatId}
                                                />
                                            ))}
                                            {isGenerating && !msg.parts.some((part) => part.type === 'text' && part.content.trim()) && (
                                                <TypingIndicator />
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            {msg.activityLog && msg.activityLog.length > 0 && (
                                                <ActivityFeed
                                                    items={msg.activityLog}
                                                    sessionId={activeChatId}
                                                />
                                            )}
                                            {!msg.content && isGenerating && (!msg.activityLog || msg.activityLog.length === 0) && (
                                                <TypingIndicator />
                                            )}
                                            {msg.content ? (
                                                <MD content={msg.content} />
                                            ) : isGenerating ? null : (
                                                <MessageSkeleton />
                                            )}
                                        </>
                                    )}
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {msg.images.map((src, i) => (
                                                <div key={i} className="relative group">
                                                    <img
                                                        src={src}
                                                        alt={t('generatedImage')}
                                                        className="max-w-sm rounded-2xl border border-border cursor-pointer hover:opacity-95 transition-opacity"
                                                        style={{ boxShadow: 'var(--shadow-soft)' }}
                                                        onClick={() => window.open(src, '_blank')}
                                                    />
                                                    <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <a
                                                            href={src}
                                                            download={`neo-image-${Date.now()}-${i}.png`}
                                                            className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                                                            title={t('download')}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <Download size={14} />
                                                        </a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {msg.videos && msg.videos.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-3">
                                            {msg.videos.map((src, i) => (
                                                <video
                                                    key={i}
                                                    src={src}
                                                    controls
                                                    className="max-w-lg rounded-2xl border border-border"
                                                    style={{ boxShadow: 'var(--shadow-soft)' }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {(() => {
                                        const isLast = msgIdx === chatMessages.length - 1
                                        if (isGenerating && isLast) return null
                                        // Only speak the visible main text (mirrors what's rendered as prose):
                                        // when parts exist we render only the `text` parts as prose; otherwise we render msg.content.
                                        // Tool-call/activity entries are intentionally excluded.
                                        const speakable = msg.parts && msg.parts.length > 0
                                            ? msg.parts
                                                .filter((p) => p.type === 'text')
                                                .map((p) => (p as { type: 'text'; content: string }).content)
                                                .join('\n\n')
                                            : (msg.content ?? '')
                                        if (!speakable.trim()) return null
                                        return <SpeakButton text={speakable} />
                                    })()}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
            <ChatInput onOpenToolApprovals={() => setShowToolApprovals(true)} />
            <ToolApprovalsModal
                open={showToolApprovals}
                onClose={() => setShowToolApprovals(false)}
                currentSessionId={activeChatId}
            />
        </div>
    )
}
