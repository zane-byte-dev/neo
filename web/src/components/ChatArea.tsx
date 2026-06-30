import React from 'react'
import { createPortal } from 'react-dom'
import { Send, Square, CheckCircle2, Circle, Loader2, ChevronRight, ChevronDown, ImagePlus, X, Download, Paperclip, FileText, FileSpreadsheet, File as FileIcon, Volume2, ShieldCheck, ShieldOff, Plus, FolderOpen, Mic, MicOff, Terminal, Globe, Wrench, BrainCircuit, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { cn } from '../lib/utils'
import { WelcomeScreen } from './WelcomeScreen'
import {
    streamChat,
    fetchPreferences,
    fetchMessages,
    uploadFiles,
    transcribeAudio,
    confirmTool,
    fetchToolResult,
    cancelRun,
    patchSession,
} from '../api'
import { t } from '../i18n'
import type { ActivityItem, AgentTodoItem, FileAttachment, Message, MessagePart } from '../types'
import { toast } from './Toast'
import { ProjectPicker } from './ProjectPicker'
import { ChatActionsMenu } from './chat/ChatActionsMenu'
import { ModelPicker } from './chat/ModelPicker'
import { ToolApprovalsModal } from './chat/ToolApprovalsModal'

const MarkdownRenderer = React.lazy(() => import('./chat/MarkdownRenderer').then((mod) => ({ default: mod.MarkdownRenderer })))
const MarkdownMathRenderer = React.lazy(() => import('./chat/MarkdownMathRenderer').then((mod) => ({ default: mod.MarkdownMathRenderer })))
const CitationRenderer = React.lazy(() => import('./notebook/CitationRenderer').then((mod) => ({ default: mod.CitationRenderer })))

// ── Tool display name map ────────────────────────────────────────────────────
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    bash:                '执行命令',
    read_file:           '读取文件',
    write_file:          '写入文件',
    list_dir:            '列出目录',
    edit_file:           '编辑文件',
    glob:                '查找文件',
    grep:                '搜索内容',
    fetch_url:           '抓取网页',
    search_web:          '搜索网络',
    browser_command:     '操控浏览器',
    get_datetime:        '获取时间',
    get_weather:         '获取天气',
    generate_video:      '生成视频',
    notebook_search:     '检索知识库',
    todo:                '管理任务',
    update_now:          '更新近况',
    update_user_profile: '更新档案',
    save_memory:         '保存记忆',
    manage_skill:        '管理技能',
    subagent:            '派发子任务',
    ask_user:            '请求确认',
    enter_plan_mode:     '进入计划模式',
    exit_plan_mode:      '退出计划模式',
    research:            '深度调研',
    run_skill:           '执行技能',
    list_skills:         '列出技能',
    code_exec:           '执行代码',
    get_chat_history:    '查看历史',
}

function toolDisplayName(toolName: string): string {
    return TOOL_DISPLAY_NAMES[toolName] ?? toolName
}

// ── Tool icon selector ───────────────────────────────────────────────────────
const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep'])
const WEB_TOOLS  = new Set(['search_web', 'fetch_url', 'research', 'browser_command'])
const RUN_TOOLS  = new Set(['bash', 'code_exec'])

function ToolIcon({ toolName, className }: { toolName: string; className?: string }) {
    if (RUN_TOOLS.has(toolName))  return <Terminal size={11} className={className} />
    if (FILE_TOOLS.has(toolName)) return <FileText  size={11} className={className} />
    if (WEB_TOOLS.has(toolName))  return <Globe     size={11} className={className} />
    return <Wrench size={11} className={className} />
}

function activityPreviewText(item: ActivityItem): string {
    if (typeof item.args?.command === 'string') return item.args.command
    if (item.type === 'tool_result') return item.result ?? ''
    return item.args ? JSON.stringify(item.args) : ''
}

/** Human-readable single-line summary of tool args. */
function semanticPreview(item: ActivityItem, max = 120): string {
    if (item.type === 'tool_result') return ''
    const args = item.args ?? {}
    const toolName = item.toolName
    // Path-based tools: show only the filename
    if (FILE_TOOLS.has(toolName)) {
        if (typeof args.path === 'string') {
            return args.path.split('/').pop() ?? args.path
        }
        if (typeof args.pattern === 'string') return compactPreview(args.pattern, max)
        if (typeof args.query === 'string') return compactPreview(`"${args.query}"`, max)
    }
    // Shell command
    if (typeof args.command === 'string') return compactPreview(args.command, max)
    // Web / research tools
    if (toolName === 'search_web' && typeof args.query === 'string') return compactPreview(args.query, max)
    if (toolName === 'fetch_url' && typeof args.url === 'string') return compactPreview(args.url, max)
    if (toolName === 'research' && typeof args.topic === 'string') return compactPreview(args.topic, max)
    // Skill tools
    if (toolName === 'run_skill' && typeof args.skill_name === 'string') return args.skill_name
    if (toolName === 'manage_skill' && typeof args.name === 'string') return args.name
    // Subagent
    if (toolName === 'subagent' && typeof args.task === 'string') return compactPreview(args.task, max)
    // Generic fallback
    if (!args || Object.keys(args).length === 0) return ''
    const pairs = Object.entries(args)
        .filter(([k]) => !['content', 'old_str', 'new_str'].includes(k))
        .map(([k, v]) => {
            const val = typeof v === 'string'
                ? v
                : (typeof v === 'number' || typeof v === 'boolean')
                    ? String(v)
                    : JSON.stringify(v)
            return `${k}: ${val}`
        })
        .join('  ·  ')
    return compactPreview(pairs, max)
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
    | { type: 'activity-batch'; items: ActivityDisplayItem[] }

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

function generateBatchSummary(items: ActivityDisplayItem[]): string {
    const counts: Record<string, number> = {}
    for (const { item } of items) counts[item.toolName] = (counts[item.toolName] ?? 0) + 1
    const toolNames = Object.keys(counts)
    const total = items.length
    if (total === 1) {
        const { item } = items[0]
        const label = toolDisplayName(item.toolName)
        const preview = semanticPreview(item, 60)
        return preview ? `${label}  ${preview}` : label
    }
    const fileCount = toolNames.filter(t => FILE_TOOLS.has(t)).reduce((s, t) => s + counts[t], 0)
    const webCount  = toolNames.filter(t => WEB_TOOLS.has(t)).reduce((s, t) => s + counts[t], 0)
    const runCount  = toolNames.filter(t => RUN_TOOLS.has(t)).reduce((s, t) => s + counts[t], 0)
    if (toolNames.length === 1) {
        const n = counts[toolNames[0]]
        return `${toolDisplayName(toolNames[0])} × ${n}`
    }
    if (fileCount > 0 && webCount === 0 && runCount === 0 && toolNames.every(n => FILE_TOOLS.has(n)))
        return t('activityBatchFiles', { count: fileCount })
    if (webCount > 0 && fileCount === 0 && runCount === 0 && toolNames.every(n => WEB_TOOLS.has(n)))
        return t('activityBatchWeb', { count: webCount })
    if (fileCount > 0 && webCount > 0 && runCount === 0)
        return t('activityBatchWebFiles', { count: fileCount + webCount })
    if (runCount > 0 && fileCount === 0 && webCount === 0)
        return t('activityBatchCommands', { count: runCount })
    return t('activityBatchOps', { count: total })
}

function mergeMessageParts(parts: MessagePart[]): RenderPart[] {
    // Render parts in their original order so the narrative is chronological.
    // Consecutive text chunks are merged to avoid split-markdown artifacts.
    // Consecutive tool-call/result pairs are batched into a single activity-batch card.
    const merged: RenderPart[] = []
    for (const part of parts) {
        if (part.type === 'text') {
            const last = merged[merged.length - 1]
            if (last?.type === 'text') {
                last.content += part.content
            } else {
                merged.push({ type: 'text', content: part.content })
            }
            continue
        }
        // Try to merge tool_result onto the previous tool_call in the current batch
        const last = merged[merged.length - 1]
        if (last?.type === 'activity-batch') {
            const batchLast = last.items[last.items.length - 1]
            if (batchLast && !batchLast.resultItem && canMergeActivityItems(batchLast.item, part.item)) {
                batchLast.resultItem = part.item
                continue
            }
            // Another tool call: append to current batch
            last.items.push({ item: part.item })
            continue
        }
        if (last?.type === 'activity' && !last.resultItem && canMergeActivityItems(last.item, part.item)) {
            // Promote the previous single activity into a batch before adding the result
            merged[merged.length - 1] = { type: 'activity-batch', items: [{ item: last.item, resultItem: part.item }] }
            continue
        }
        // Start a new batch with this item
        merged.push({ type: 'activity-batch', items: [{ item: part.item }] })
    }
    // Flatten single-item batches back to individual activity for backward compat
    return merged.map(p => {
        if (p.type === 'activity-batch' && p.items.length === 1) {
            const { item, resultItem } = p.items[0]
            return { type: 'activity' as const, item, resultItem }
        }
        return p
    })
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

function messageMainText(msg: Message): string {
    if (msg.parts?.length) {
        return msg.parts
            .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
            .map((part) => part.content)
            .join('\n\n')
    }
    return msg.content ?? ''
}

async function copyTextToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
    }
    if (typeof document === 'undefined') throw new Error('Clipboard unavailable')
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!copied) throw new Error('Clipboard unavailable')
}

function CopyReplyButton({ text }: { text: string }) {
    const [copied, setCopied] = React.useState(false)
    const resetTimer = React.useRef<number | null>(null)

    React.useEffect(() => {
        return () => {
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
        }
    }, [])

    if (!text.trim()) return null

    const handleClick = async () => {
        try {
            await copyTextToClipboard(text)
            setCopied(true)
            toast.success(t('replyCopied'), 1600)
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
            resetTimer.current = window.setTimeout(() => setCopied(false), 1600)
        } catch {
            toast.error(t('copyReplyFailed'))
        }
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer',
                copied
                    ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
            )}
            title={copied ? t('replyCopied') : t('copyReply')}
            aria-label={copied ? t('replyCopied') : t('copyReply')}
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
    )
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
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer',
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

// ── Error message helpers ────────────────────────────────────────────────────

function isErrorMessage(content: string | undefined): boolean {
    if (!content) return false
    const trimmed = content.trim()
    return trimmed.startsWith('⚠️') ||
           trimmed.startsWith('Stream error:')
}

const ErrorMessageCard: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
    const clean = message.trim().replace(/^⚠️\s*/, '')
    return (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-start gap-2.5">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-destructive/70" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-destructive/80 leading-relaxed break-words">{clean}</p>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs text-destructive/60 hover:text-destructive transition-colors cursor-pointer"
                        >
                            <RefreshCw size={11} />
                            <span>重试</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── User message bubble (collapsible for long content) ───────────────────────

const COLLAPSE_CHAR_THRESHOLD = 350

const UserMessageBubble: React.FC<{ content: string }> = ({ content }) => {
    const lineCount = (content.match(/\n/g) ?? []).length + 1
    const isLong = content.length > COLLAPSE_CHAR_THRESHOLD || lineCount > 8
    const [collapsed, setCollapsed] = React.useState(isLong)

    return (
        <div>
            <div className="relative">
                <div
                    className={cn(
                        'px-4 sm:px-5 py-2.5 sm:py-3 bg-user-bubble border border-user-bubble-border rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap break-words',
                        collapsed && 'max-h-[7.5rem] overflow-hidden'
                    )}
                    style={{ boxShadow: 'var(--shadow-soft)', overflowWrap: 'anywhere' }}
                >
                    {content}
                </div>
                {collapsed && (
                    <div
                        className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none rounded-b-2xl rounded-br-md"
                        style={{ background: 'linear-gradient(to top, var(--color-user-bubble), transparent)' }}
                    />
                )}
            </div>
            {isLong && (
                <button
                    type="button"
                    onClick={() => setCollapsed(c => !c)}
                    className="mt-1 flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors ml-auto cursor-pointer"
                >
                    <ChevronDown size={12} className={cn('transition-transform duration-200', !collapsed && 'rotate-180')} />
                    <span>{collapsed ? '展开' : '收起'}</span>
                </button>
            )}
        </div>
    )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

const MarkdownLoading: React.FC = () => (
    <div className="space-y-2 animate-fade-in">
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton h-4 w-2/3" />
    </div>
)

function contentMayContainMath(content: string): boolean {
    return /(^|[^\\])\$\$[\s\S]+?\$\$/.test(content)
        || /\\\(|\\\[|\\begin\{/.test(content)
        || /(^|[^\\])\$[^\s$](?:[^$\n]*[^\s$])?\$/.test(content)
}

const MD: React.FC<{ content: string }> = ({ content }) => (
    <React.Suspense fallback={<MarkdownLoading />}>
        {contentMayContainMath(content) ? (
            <MarkdownMathRenderer content={content} />
        ) : (
            <MarkdownRenderer content={content} />
        )}
    </React.Suspense>
)

const CitedMD: React.FC<{
    content: string
    sources?: Message['citations']
}> = ({ content, sources }) => (
    <React.Suspense fallback={<MarkdownLoading />}>
        <CitationRenderer content={content} sources={sources} />
    </React.Suspense>
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
    const activeChatId = useAppStore(s => s.activeChatId)
    const isGenerating = useAppStore(s => activeChatId ? !!s.generatingBySession[activeChatId] : false)

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

const ActivityItemCard: React.FC<{ item: ActivityItem; resultItem?: ActivityItem; sessionId?: string | null; compact?: boolean }> = ({ item, resultItem, sessionId, compact }) => {
    const [expandedResult, setExpandedResult] = React.useState<string | null>(null)
    const [expanding, setExpanding] = React.useState(false)
    const [showDetails, setShowDetails] = React.useState(false)
    const updateActivityConfirmStatus = useAppStore(s => s.updateActivityConfirmStatus)
    const status = item.type === 'tool_confirm' ? (item.confirmStatus ?? 'pending') : undefined
    const targetResult = resultItem ?? (item.type === 'tool_result' ? item : undefined)
    const inputText = item.type === 'tool_result' ? '' : activityPreviewText(item)
    const outputText = targetResult ? (expandedResult ?? targetResult.result ?? '') : ''
    const preview = semanticPreview(item) || compactPreview(outputText, 120)
    const needsDetails = Boolean(inputText || outputText)
    const isBlocked = targetResult?.result?.startsWith('[BLOCKED]') || status === 'denied'
    const tone = status === 'pending'
        ? 'border-warning/30 bg-warning/5'
        : isBlocked
            ? 'border-warning/20 bg-warning/5'
            : compact
                ? 'border-transparent bg-transparent'
                : 'border-border/50 bg-fill-secondary/25'
    // Status icon
    const StatusIcon = status === 'pending'
        ? () => <span className="shrink-0 text-[11px] text-warning">⚠</span>
        : isBlocked
            ? () => <span className="shrink-0 text-[11px] text-warning">⚠</span>
            : targetResult || item.type === 'tool_result' || status === 'approved'
                ? () => <CheckCircle2 size={11} className="shrink-0 text-success" />
                : () => <Loader2 size={11} className="shrink-0 text-primary-mint animate-spin" />

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
            <div
                className={cn('my-1.5 rounded-xl px-3 py-2 text-xs transition-colors duration-150 border', tone, needsDetails && 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}
                style={{ boxShadow: 'var(--shadow-soft)' }}
                onClick={needsDetails ? toggleDetails : undefined}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon />
                    <ToolIcon toolName={item.toolName} className="shrink-0 text-text-tertiary" />
                    <span className="font-medium text-text-secondary shrink-0">{toolDisplayName(item.toolName)}</span>
                    {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                    {needsDetails && (
                        <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', showDetails && 'rotate-180')} />
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
                    <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                        {inputText && (
                            <div className="pl-3">
                                <div className="text-[10px] font-medium text-text-quaternary mb-1">输入</div>
                                <div className="border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary whitespace-pre-wrap break-words">{inputText}</div>
                            </div>
                        )}
                        {outputText && (
                            <div className="pl-3">
                                <div className="text-[10px] font-medium text-text-quaternary mb-1">输出</div>
                                <div className="border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary whitespace-pre-wrap break-words">{outputText}</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div
            role={needsDetails ? 'button' : undefined}
            tabIndex={needsDetails ? 0 : undefined}
            className={cn('my-1.5 rounded-xl px-3 py-2 text-xs transition-colors duration-150 border', tone, needsDetails && 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}
            style={compact ? undefined : { boxShadow: 'var(--shadow-soft)' }}
            onClick={needsDetails ? toggleDetails : undefined}
            onKeyDown={needsDetails ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetails() } } : undefined}
        >
            <div className="flex items-center gap-2 min-w-0">
                <StatusIcon />
                <ToolIcon toolName={item.toolName} className="shrink-0 text-text-tertiary" />
                <span className="font-medium text-text-secondary shrink-0">{toolDisplayName(item.toolName)}</span>
                {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                {needsDetails && (
                    <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', showDetails && 'rotate-180')} />
                )}
            </div>
            {showDetails && needsDetails && (
                <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                    {inputText && (
                        <div className="pl-3">
                            <div className="text-[10px] font-medium text-text-quaternary mb-1">输入</div>
                            <div className="border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary whitespace-pre-wrap break-words">{inputText}</div>
                        </div>
                    )}
                    {outputText && (
                        <div className="pl-3">
                            <div className="text-[10px] font-medium text-text-quaternary mb-1">输出</div>
                            <div className="border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary whitespace-pre-wrap break-words">{outputText}</div>
                        </div>
                    )}
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

// ── Activity batch card (groups consecutive tool calls) ───────────────────────────────
const ActivityBatchCard: React.FC<{ items: ActivityDisplayItem[]; sessionId?: string | null }> = ({ items, sessionId }) => {
    const [expanded, setExpanded] = React.useState(false)
    const summary = generateBatchSummary(items)
    const hasConfirm  = items.some(d => d.item.type === 'tool_confirm' && (!d.item.confirmStatus || d.item.confirmStatus === 'pending'))
    const hasBlocked  = items.some(d => d.resultItem?.result?.startsWith('[BLOCKED]'))
    const allSettled  = items.every(d => d.resultItem || d.item.type === 'tool_result' ||
        (d.item.type === 'tool_confirm' && d.item.confirmStatus && d.item.confirmStatus !== 'pending'))
    const tone = hasConfirm ? 'border-warning/30 bg-warning/5'
        : hasBlocked ? 'border-warning/20 bg-warning/5'
        : 'border-border/50 bg-fill-secondary/25'
    return (
        <div className={cn('my-2 rounded-xl border text-xs overflow-hidden transition-colors duration-150', tone)}
             style={{ boxShadow: 'var(--shadow-soft)' }}>
            <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 hover:brightness-95 dark:hover:brightness-110 transition-colors min-w-0"
                onClick={() => setExpanded(e => !e)}
            >
                {hasConfirm ? (
                    <span className="shrink-0 text-[11px] text-warning">⚠</span>
                ) : allSettled ? (
                    <CheckCircle2 size={11} className="shrink-0 text-success" />
                ) : (
                    <Loader2 size={11} className="shrink-0 text-primary-mint animate-spin" />
                )}
                <span className="flex-1 text-left font-medium text-text-secondary min-w-0 truncate">{summary}</span>
                {items.length > 1 && (
                    <span className="shrink-0 tabular-nums text-[10px] text-text-quaternary bg-fill-tertiary px-1.5 py-0.5 rounded-full">{items.length}</span>
                )}
                <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', expanded && 'rotate-180')} />
            </button>
            {expanded && (
                <div className="border-t border-border/40 px-2 py-1.5 space-y-0.5" onClick={e => e.stopPropagation()}>
                    {items.map(({ item, resultItem }, idx) => (
                        <ActivityItemCard
                            key={`${item.type}-${item.confirmId ?? item.resultId ?? item.timestamp}-${resultItem?.resultId ?? 'none'}-${idx}`}
                            item={item}
                            resultItem={resultItem}
                            sessionId={sessionId}
                            compact
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

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

// ── Chat input ────────────────────────────────────────────────────────────────

interface PendingDocument {
    filename: string
    text: string
    pageCount?: number
    mimeType?: string
}

export interface SlashCommand {
    id: string
    label: string
    icon?: React.ComponentType<{ size?: number; className?: string }>
    description?: string
}

const ChatInput: React.FC<{
    onOpenToolApprovals: () => void
    slashCommands?: SlashCommand[]
    onSlashCommand?: (id: string) => void
}> = ({ onOpenToolApprovals, slashCommands, onSlashCommand }) => {
    const {
        inputValue, setInputValue,
        pendingQuickReply, setPendingQuickReply,
        activeChatId, addMessage, updateLastAssistantMessage, addImageToLastAssistantMessage,
        addVideoToLastAssistantMessage,
        updateLastAssistantThinking, updateLastAssistantTodos, appendToLastAssistantActivity, updateActivityConfirmStatus,
        setLastAssistantCitations,
        chats,
        setIsGenerating,
        setCurrentRunId, setAbortController, setThinkingStatus,
        selectedModel, setSelectedModel,
        setChatModel,
        confirmDangerous, setConfirmDangerous,
    } = useAppStore()
    const isGenerating = useAppStore(s => activeChatId ? !!s.generatingBySession[activeChatId] : false)
    const activeRunId = useAppStore(s => activeChatId ? (s.currentRunIdBySession[activeChatId] ?? null) : null)

    // Restore per-chat model when switching chats
    const prevChatIdRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (activeChatId && activeChatId !== prevChatIdRef.current) {
            prevChatIdRef.current = activeChatId
            const chat = chats.find(c => c.id === activeChatId)
            if (chat?.chatModel) setSelectedModel(chat.chatModel)
        }
    }, [activeChatId])

    // Persist model choice to the active chat when user changes it
    const handleModelSelect = React.useCallback((model: string) => {
        setSelectedModel(model as typeof selectedModel)
        if (activeChatId) {
            setChatModel(activeChatId, model)
            patchSession(activeChatId, { chatModel: model === 'auto' ? null : model }).catch(() => {
                toast.error(t('chatModelSaveFailed'))
            })
        }
    }, [activeChatId, setSelectedModel, setChatModel])

    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const docInputRef = React.useRef<HTMLInputElement>(null)
    const folderInputRef = React.useRef<HTMLInputElement>(null)
    const [pendingImages, setPendingImages] = React.useState<string[]>([])
    const [pendingDocs, setPendingDocs] = React.useState<PendingDocument[]>([])
    const [isUploading, setIsUploading] = React.useState(false)
    const [isStopPending, setIsStopPending] = React.useState(false)
    const [availableModels, setAvailableModels] = React.useState<string[]>([])
    const [slashDropdownIdx, setSlashDropdownIdx] = React.useState(-1)
    const stopRequestKeyRef = React.useRef<string | null>(null)

    // Filtered slash commands based on current input
    const slashQuery = inputValue.startsWith('/') && !inputValue.includes(' ')
        ? inputValue.slice(1).toLowerCase()
        : null
    const filteredCmds = slashQuery !== null && slashCommands?.length
        ? slashCommands.filter((c) => slashQuery === '' || c.id.startsWith(slashQuery) || c.label.includes(slashQuery))
        : []
    const showSlashDropdown = filteredCmds.length > 0

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

    const currentStopKey = activeChatId
        ? (activeRunId ? `run:${activeRunId}` : `session:${activeChatId}`)
        : null

    React.useEffect(() => {
        if (!isGenerating || stopRequestKeyRef.current !== currentStopKey) {
            stopRequestKeyRef.current = null
            setIsStopPending(false)
        }
    }, [currentStopKey, isGenerating])

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

    const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
            console.error('Folder upload failed:', err)
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
        const sid = activeChatId
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

        addMessage(sid, {
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
        setIsGenerating(sid, true)
        setThinkingStatus(sid, t('thinking'))

        // Placeholder for assistant
        addMessage(sid, {
            id: Math.random().toString(36).substring(7),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        })

        const controller = new AbortController()
        setAbortController(sid, controller)
        let accumulated = ''
        let thinkingAccum = ''

        try {
            const activeChat = chats.find((c) => c.id === sid)
            const notebookId = activeChat?.mode === 'notebook' ? activeChat.notebookId : undefined
            const sourceIds = activeChat?.mode === 'notebook' ? activeChat.sourceIds : undefined
            for await (const chunk of streamChat(
                text, sid, controller.signal, selectedModel, images,
                documents?.map(d => ({ filename: d.filename, text: d.text })),
                confirmDangerous,
                notebookId, sourceIds,
            )) {
                if (chunk.type === 'run' && chunk.runId) {
                    setCurrentRunId(sid, chunk.runId)
                    continue
                }
                if (chunk.type === 'session') {
                    // Notebook auto-bind: server resolved/created the real session id; ignore for now since
                    // chatSlice.openOrCreateNotebookChat already resolved it before sending.
                    continue
                }
                if (chunk.type === 'citations' && chunk.citations) {
                    setLastAssistantCitations(sid, chunk.citations)
                    continue
                }
                if (chunk.type === 'done') break
                if (chunk.type === 'error') throw new Error(chunk.text ?? 'Unknown error')
                if (chunk.type === 'thought') {
                    thinkingAccum += chunk.text ?? ''
                    // Real-time thinking display
                    updateLastAssistantThinking(sid, thinkingAccum)
                } else if (chunk.type === 'tool_call') {
                    // Update status bar with current tool name
                    const toolLabel = toolDisplayName(chunk.toolName ?? 'tool')
                    const toolPreview = chunk.args
                        ? semanticPreview({ type: 'tool_call', toolName: chunk.toolName ?? 'tool', args: chunk.args, timestamp: Date.now() }, 50)
                        : ''
                    setThinkingStatus(sid, toolPreview ? `${toolLabel}  ${toolPreview}` : toolLabel)
                    appendToLastAssistantActivity(sid, {
                        type: 'tool_call',
                        toolName: chunk.toolName ?? 'tool',
                        args: chunk.args,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_result') {
                    appendToLastAssistantActivity(sid, {
                        type: 'tool_result',
                        toolName: chunk.toolName ?? 'tool',
                        result: chunk.result,
                        resultId: chunk.resultId,
                        truncated: chunk.truncated,
                        timestamp: Date.now(),
                    })
                } else if (chunk.type === 'tool_confirm' && chunk.confirmId) {
                    appendToLastAssistantActivity(sid, {
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
                    updateActivityConfirmStatus(sid, chunk.confirmId, chunk.confirmStatus, chunk.approvalScope)
                } else if (chunk.type === 'text' && chunk.text) {
                    if (!accumulated) setThinkingStatus(sid, '')
                    accumulated += chunk.text
                    updateLastAssistantMessage(sid, accumulated)
                } else if (chunk.type === 'image' && chunk.url) {
                    setThinkingStatus(sid, '')
                    addImageToLastAssistantMessage(sid, chunk.url)
                } else if (chunk.type === 'video' && chunk.url) {
                    setThinkingStatus(sid, '')
                    addVideoToLastAssistantMessage(sid, chunk.url)
                } else if (chunk.type === 'todo_update' && chunk.todos) {
                    updateLastAssistantTodos(sid, chunk.todos as AgentTodoItem[])
                }
            }
        } catch (err: unknown) {
            const name = err instanceof Error ? err.name : ''
            if (name !== 'AbortError' && !accumulated) {
                updateLastAssistantMessage(sid, `⚠️ ${err instanceof Error ? err.message : t('requestFailed')}`)
            }
        } finally {
            if (thinkingAccum) {
                updateLastAssistantThinking(sid, thinkingAccum)
            }
            setIsGenerating(sid, false)
            setCurrentRunId(sid, null)
            setThinkingStatus(sid, '')
            setAbortController(sid, null)
        }
    }

    const handleStop = async () => {
        if (!activeChatId) return
        const sid = activeChatId
        const runId = useAppStore.getState().currentRunIdBySession[sid]
        const stopKey = runId ? `run:${runId}` : `session:${sid}`
        if (stopRequestKeyRef.current === stopKey) return
        stopRequestKeyRef.current = stopKey
        setIsStopPending(true)
        if (runId) {
            try {
                await cancelRun(runId)
                return
            } catch {
                // Fall back to local abort when cancel API is unavailable.
            }
        }
        const controller = useAppStore.getState().abortControllerBySession[sid]
        if (controller) {
            controller.abort()
            return
        }
        stopRequestKeyRef.current = null
        setIsStopPending(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Slash command dropdown navigation
        if (showSlashDropdown) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashDropdownIdx((i) => Math.min(i + 1, filteredCmds.length - 1))
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashDropdownIdx((i) => Math.max(i - 1, 0))
                return
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                const idx = slashDropdownIdx >= 0 ? slashDropdownIdx : 0
                const cmd = filteredCmds[idx]
                if (cmd) {
                    setInputValue('')
                    setSlashDropdownIdx(-1)
                    onSlashCommand?.(cmd.id)
                }
                return
            }
            if (e.key === 'Escape') {
                e.preventDefault()
                setInputValue('')
                setSlashDropdownIdx(-1)
                return
            }
        }
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

    // Attachment menu
    const [attachMenuOpen, setAttachMenuOpen] = React.useState(false)
    const attachMenuRef = React.useRef<HTMLDivElement>(null)
    const attachButtonRef = React.useRef<HTMLButtonElement>(null)
    const [attachMenuStyle, setAttachMenuStyle] = React.useState<React.CSSProperties>({})
    React.useLayoutEffect(() => {
        if (!attachMenuOpen) return
        const rect = attachButtonRef.current?.getBoundingClientRect()
        if (!rect) return
        setAttachMenuStyle({
            position: 'fixed',
            left: rect.left,
            bottom: window.innerHeight - rect.top + 6,
            width: 160,
        })
    }, [attachMenuOpen])
    React.useEffect(() => {
        const onClick = (e: MouseEvent) => {
            const target = e.target as Node
            if (attachMenuRef.current?.contains(target) || attachButtonRef.current?.contains(target)) return
            setAttachMenuOpen(false)
        }
        if (attachMenuOpen) document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [attachMenuOpen])

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

    // ── Voice input state machine ───────────────────────────────────────────────
    // States: idle | recording | transcribing
    type VoiceState = 'idle' | 'recording' | 'transcribing'
    const [voiceState, setVoiceState] = React.useState<VoiceState>('idle')
    const [voiceError, setVoiceError] = React.useState<string | null>(null)
    const [recordingSeconds, setRecordingSeconds] = React.useState(0)
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
    const audioChunksRef = React.useRef<Blob[]>([])
    const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
    const MAX_RECORDING_SECONDS = 90

    const stopRecordingTimer = () => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
    }

    const cancelRecording = React.useCallback(() => {
        stopRecordingTimer()
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
            mediaRecorderRef.current.stop()
        }
        mediaRecorderRef.current = null
        audioChunksRef.current = []
        setVoiceState('idle')
        setRecordingSeconds(0)
        setVoiceError(null)
    }, [])

    // Clean up on unmount
    React.useEffect(() => () => cancelRecording(), [cancelRecording])

    const handleVoiceClick = async () => {
        // Cancel if recording
        if (voiceState === 'recording') {
            // Stopping triggers onstop → transcription
            stopRecordingTimer()
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop()
            }
            return
        }

        // Ignore while transcribing
        if (voiceState === 'transcribing') return

        setVoiceError(null)

        // Check browser support
        if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setVoiceError(t('voiceErrorNoSupport'))
            return
        }

        // Check secure context
        if (!window.isSecureContext) {
            setVoiceError(t('voiceErrorInsecure'))
            return
        }

        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('not allowed')) {
                setVoiceError(t('voiceErrorPermission'))
            } else {
                setVoiceError(t('voiceErrorNoSupport'))
            }
            return
        }

        // Pick a supported MIME type
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
            .find(m => MediaRecorder.isTypeSupported(m)) ?? ''

        audioChunksRef.current = []
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data)
        }

        recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop())
            const chunks = audioChunksRef.current
            audioChunksRef.current = []
            mediaRecorderRef.current = null
            setRecordingSeconds(0)

            if (chunks.length === 0) {
                setVoiceState('idle')
                return
            }

            setVoiceState('transcribing')
            const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
            const ext = (mimeType || 'audio/webm').split('/')[1]?.split(';')[0] ?? 'webm'
            try {
                const text = await transcribeAudio(blob, `recording.${ext}`)
                const current = useAppStore.getState().inputValue
                setInputValue(current ? `${current} ${text}` : text)
                setVoiceState('idle')
                // Re-focus textarea after inserting text
                setTimeout(() => textareaRef.current?.focus(), 50)
            } catch (err) {
                const msg = err instanceof Error ? err.message : ''
                if (msg.toLowerCase().includes('no transcription provider') || msg.toLowerCase().includes('api key')) {
                    setVoiceError(t('voiceErrorNoProvider'))
                } else {
                    setVoiceError(t('voiceErrorGeneric'))
                }
                setVoiceState('idle')
            }
        }

        recorder.start(250) // collect chunks every 250ms
        setVoiceState('recording')
        setRecordingSeconds(0)

        // Start timer, auto-stop at MAX_RECORDING_SECONDS
        recordingTimerRef.current = setInterval(() => {
            setRecordingSeconds((s) => {
                const next = s + 1
                if (next >= MAX_RECORDING_SECONDS) {
                    stopRecordingTimer()
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                        mediaRecorderRef.current.stop()
                    }
                }
                return next
            })
        }, 1000)
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
            <div className="max-w-3xl mx-auto min-w-0 relative">
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
                <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-expect-error webkitdirectory is not in standard types
                    webkitdirectory=""
                    multiple
                    className="hidden"
                    onChange={handleFolderSelect}
                />
                {/* Slash command dropdown */}
                {showSlashDropdown && (
                    <div className="absolute bottom-full left-0 right-0 mb-1.5 z-50">
                        <div className="mx-2 bg-bg-container border border-border rounded-xl shadow-lg overflow-hidden">
                            {filteredCmds.map((cmd, i) => (
                                <button
                                    key={cmd.id}
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        setInputValue('')
                                        setSlashDropdownIdx(-1)
                                        onSlashCommand?.(cmd.id)
                                    }}
                                    className={cn(
                                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                                        i === slashDropdownIdx
                                            ? 'bg-primary-mint/10 text-primary-mint'
                                            : 'text-text hover:bg-fill-secondary/60',
                                    )}
                                >
                                    {cmd.icon && <cmd.icon size={14} className="shrink-0 text-text-tertiary" />}
                                    <span className="font-medium shrink-0">/{cmd.id}</span>
                                    {cmd.description && (
                                        <span className="text-text-tertiary text-xs truncate">{cmd.description}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
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
                        onChange={(e) => { setInputValue(e.target.value); setSlashDropdownIdx(-1) }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={t('askAnything')}
                        className="w-full bg-transparent px-5 pt-3.5 pb-2 pr-14 focus:outline-none resize-none text-sm leading-relaxed placeholder:text-text-tertiary"
                        rows={1}
                    />
                    {/* Bottom bar: attachment drawer + project + model + send */}
                    <div className="flex items-center justify-between px-3 pb-2.5 gap-2 min-w-0">
                        <div className="flex items-center gap-1 min-w-0 flex-1 mobile-scroll-x">
                            {/* "+" Attachment drawer */}
                            <div className="relative shrink-0">
                                <button
                                    ref={attachButtonRef}
                                    onClick={() => setAttachMenuOpen((v) => !v)}
                                    className={cn(
                                        'p-1.5 rounded-lg transition-all duration-150 cursor-pointer',
                                        attachMenuOpen
                                            ? 'bg-fill text-text-secondary'
                                            : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                                    )}
                                    title={t('addAttachment')}
                                    type="button"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            {attachMenuOpen && typeof document !== 'undefined' && createPortal(
                                <div
                                    ref={attachMenuRef}
                                    className="rounded-xl border border-border bg-bg-container shadow-lg z-[120] py-1 overflow-hidden"
                                    style={attachMenuStyle}
                                >
                                    <button
                                        onClick={() => { fileInputRef.current?.click(); setAttachMenuOpen(false) }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-fill-secondary/60 transition-colors"
                                        type="button"
                                    >
                                        <ImagePlus size={14} className="text-text-tertiary shrink-0" />
                                        <span>{t('attachImage')}</span>
                                    </button>
                                    <button
                                        onClick={() => { docInputRef.current?.click(); setAttachMenuOpen(false) }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-fill-secondary/60 transition-colors"
                                        type="button"
                                        disabled={isUploading}
                                    >
                                        <Paperclip size={14} className="text-text-tertiary shrink-0" />
                                        <span>{t('attachDocument')}</span>
                                    </button>
                                    <button
                                        onClick={() => { folderInputRef.current?.click(); setAttachMenuOpen(false) }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-fill-secondary/60 transition-colors"
                                        type="button"
                                        disabled={isUploading}
                                    >
                                        <FolderOpen size={14} className="text-text-tertiary shrink-0" />
                                        <span>{t('attachFolder')}</span>
                                    </button>
                                </div>,
                                document.body,
                            )}
                            {/* Project picker (目录选择) */}
                            {activeChatId && (
                                <ProjectPicker
                                    sessionId={activeChatId}
                                    projectRoot={chats.find((c) => c.id === activeChatId)?.projectRoot ?? null}
                                />
                            )}
                            <ModelPicker
                                selectedModel={selectedModel}
                                onSelect={handleModelSelect}
                                availableModels={availableModels}
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {isGenerating && (
                                <span className="text-[11px] text-text-tertiary hidden sm:inline">
                                    {t('pressEscToStop')}
                                </span>
                            )}
                            {/* Mic button — hidden while generating */}
                            {!isGenerating && (
                                <button
                                    type="button"
                                    onClick={() => void handleVoiceClick()}
                                    disabled={voiceState === 'transcribing'}
                                    className={cn(
                                        'p-2 rounded-xl transition-all duration-200 cursor-pointer',
                                        voiceState === 'recording'
                                            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 animate-pulse'
                                            : voiceState === 'transcribing'
                                                ? 'bg-fill text-text-tertiary cursor-wait'
                                                : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                                    )}
                                    title={
                                        voiceState === 'recording'
                                            ? t('voiceStop')
                                            : voiceState === 'transcribing'
                                                ? t('voiceTranscribing')
                                                : t('voiceInput')
                                    }
                                    aria-label={voiceState === 'recording' ? t('voiceStop') : t('voiceInput')}
                                >
                                    {voiceState === 'transcribing'
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : voiceState === 'recording'
                                            ? <MicOff size={14} />
                                            : <Mic size={14} />}
                                </button>
                            )}
                            {isGenerating ? (
                                <button
                                    onClick={handleStop}
                                    disabled={isStopPending}
                                    className={cn(
                                        'p-2 bg-text text-bg-container rounded-xl transition-all duration-200',
                                        isStopPending
                                            ? 'opacity-60 cursor-not-allowed'
                                            : 'hover:opacity-80 hover:scale-105 active:scale-95 cursor-pointer',
                                    )}
                                    title={t('stopEsc')}
                                >
                                    {isStopPending
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <Square size={14} fill="currentColor" />}
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
                    {/* Voice status strip — recording indicator, elapsed time, error */}
                    {(voiceState === 'recording' || voiceState === 'transcribing' || voiceError) && (
                        <div className={cn(
                            'flex items-center gap-2 px-3 py-1.5 mx-0 rounded-b-2xl text-xs',
                            voiceError
                                ? 'bg-destructive/8 text-destructive'
                                : 'bg-primary-mint/8 text-primary-mint'
                        )}>
                            {voiceError ? (
                                <>
                                    <span className="flex-1">{voiceError}</span>
                                    <button
                                        type="button"
                                        onClick={() => setVoiceError(null)}
                                        className="shrink-0 p-0.5 rounded hover:bg-destructive/10 transition-colors"
                                        aria-label={t('cancel')}
                                    >
                                        <X size={12} />
                                    </button>
                                </>
                            ) : voiceState === 'recording' ? (
                                <>
                                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
                                    <span className="flex-1">{t('voiceRecording')}</span>
                                    <span className="tabular-nums shrink-0">
                                        {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={cancelRecording}
                                        className="shrink-0 p-0.5 rounded hover:bg-primary-mint/10 transition-colors ml-1"
                                        aria-label={t('voiceCancel')}
                                        title={t('voiceCancel')}
                                    >
                                        <X size={12} />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Loader2 size={12} className="animate-spin shrink-0" />
                                    <span>{t('voiceTranscribing')}</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
                {/* Safety confirm + tool approval rules row */}
                <div className="flex items-center gap-2 mt-1.5 px-1 flex-wrap">
                    <button
                        onClick={() => setConfirmDangerous(!confirmDangerous)}
                        className={cn(
                            'flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] transition-all duration-150 cursor-pointer',
                            confirmDangerous
                                ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                                : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                        )}
                        title={confirmDangerous ? t('safeConfirmTitleOn') : t('safeConfirmTitleOff')}
                        type="button"
                    >
                        {confirmDangerous ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                        <span className="ml-0.5">{confirmDangerous ? t('safeConfirmOn') : t('safeConfirmOff')}</span>
                    </button>
                    <button
                        onClick={onOpenToolApprovals}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] text-text-tertiary hover:text-text-secondary hover:bg-fill transition-all duration-150 cursor-pointer"
                        type="button"
                    >
                        {t('manageToolApprovals')}
                    </button>
                    <span className="ml-auto hidden sm:flex items-center gap-1 text-[10px] text-text-quaternary select-none">
                        <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Enter</kbd> {t('enterToSend')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">Shift+Enter</kbd> {t('shiftEnterNewline')} · <kbd className="px-1 py-0.5 rounded bg-fill border border-border-secondary text-[10px]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+N</kbd> {t('newChatShortcut')}
                    </span>
                </div>
            </div>
        </div>
    )
}

// ── Chat area ─────────────────────────────────────────────────────────────────

export const ChatArea: React.FC<{
    slashCommands?: SlashCommand[]
    onSlashCommand?: (id: string) => void
}> = ({ slashCommands, onSlashCommand }) => {
    const { chats, activeChatId, messages, setMessages, setPendingQuickReply } = useAppStore()
    const isGenerating = useAppStore(s => activeChatId ? !!s.generatingBySession[activeChatId] : false)
    const thinkingStatus = useAppStore(s => activeChatId ? (s.thinkingStatusBySession[activeChatId] ?? '') : '')
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
                {activeChat && (
                    <ChatActionsMenu chat={activeChat} messages={chatMessages} />
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
                                        <UserMessageBubble content={msg.content} />
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-1 py-1 text-sm leading-relaxed">
                                    {msg.thinking && (
                                        <div className="mb-3">
                                            {/* Show first paragraph inline as a progress note; rest goes in a details */}
                                            {(() => {
                                                const lines = msg.thinking.trim().split('\n')
                                                const firstPara = lines[0]?.trim() ?? ''
                                                const rest = lines.slice(1).join('\n').trim()
                                                return (
                                                    <div className="text-xs text-text-secondary leading-relaxed">
                                                        <div className="flex items-start gap-1.5 mb-1">
                                                            <BrainCircuit size={12} className="shrink-0 mt-0.5 text-text-quaternary" />
                                                            <span className="flex-1">{firstPara}</span>
                                                        </div>
                                                        {rest && (
                                                            <details className="group ml-5">
                                                                <summary className="cursor-pointer text-[11px] text-text-quaternary hover:text-text-tertiary select-none list-none flex items-center gap-1 py-0.5">
                                                                    <ChevronRight size={10} className="transition-transform duration-200 group-open:rotate-90" />
                                                                    {t('thinkingLabel')}
                                                                </summary>
                                                                <div className="mt-1.5 pl-3 border-l-2 border-border/50 text-[11px] text-text-tertiary whitespace-pre-wrap">{rest}</div>
                                                            </details>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </div>
                                    )}
                                    {msg.todos && msg.todos.length > 0 && (
                                        <TodoPanel todos={msg.todos} />
                                    )}
                                    {msg.parts && msg.parts.length > 0 ? (
                                        <div>
                                            {mergeMessageParts(msg.parts).map((part, idx) => {
                                                if (part.type === 'text') return (
                                                    <div key={`${msg.id}-text-${idx}`} className="mb-3 last:mb-0">
                                                        {activeChat?.mode === 'notebook' ? (
                                                            <CitedMD content={part.content} sources={msg.citations} />
                                                        ) : (
                                                            <MD content={part.content} />
                                                        )}
                                                    </div>
                                                )
                                                if (part.type === 'activity-batch') return (
                                                    <ActivityBatchCard
                                                        key={`${msg.id}-batch-${idx}`}
                                                        items={part.items}
                                                        sessionId={activeChatId}
                                                    />
                                                )
                                                return (
                                                    <ActivityItemCard
                                                        key={`${msg.id}-activity-${part.item.confirmId ?? part.item.resultId ?? part.item.timestamp}-${part.resultItem?.resultId ?? 'none'}-${idx}`}
                                                        item={part.item}
                                                        resultItem={part.resultItem}
                                                        sessionId={activeChatId}
                                                    />
                                                )
                                            })}
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
                                                isErrorMessage(msg.content) ? (
                                                    <ErrorMessageCard
                                                        message={msg.content}
                                                        onRetry={chatMessages[msgIdx - 1]?.role === 'user' && chatMessages[msgIdx - 1]?.content
                                                            ? () => setPendingQuickReply(chatMessages[msgIdx - 1].content)
                                                            : undefined}
                                                    />
                                                ) : activeChat?.mode === 'notebook' ? (
                                                    <CitedMD content={msg.content} sources={msg.citations} />
                                                ) : (
                                                    <MD content={msg.content} />
                                                )
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
                                        if (isErrorMessage(msg.content)) return null
                                        const actionText = messageMainText(msg)
                                        if (!actionText.trim()) return null
                                        return (
                                            <div className="mt-2 flex items-center gap-1">
                                                <CopyReplyButton text={actionText} />
                                                <SpeakButton text={actionText} />
                                            </div>
                                        )
                                    })()}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <ScrollToBottom onClick={scrollToBottom} visible={showScrollBtn} />
            <ChatInput
                onOpenToolApprovals={() => setShowToolApprovals(true)}
                slashCommands={slashCommands}
                onSlashCommand={onSlashCommand}
            />
            <ToolApprovalsModal
                open={showToolApprovals}
                onClose={() => setShowToolApprovals(false)}
                currentSessionId={activeChatId}
            />
        </div>
    )
}
