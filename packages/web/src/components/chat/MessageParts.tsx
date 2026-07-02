import React from 'react'
import { CheckCircle2, ChevronDown, Circle, File as FileIcon, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { t } from '../../i18n'
import { cn } from '../../lib/utils'
import type { AgentTodoItem, Message } from '../../types'

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer').then((mod) => ({ default: mod.MarkdownRenderer })))
const MarkdownMathRenderer = React.lazy(() => import('./MarkdownMathRenderer').then((mod) => ({ default: mod.MarkdownMathRenderer })))
const CitationRenderer = React.lazy(() => import('../notebook/CitationRenderer').then((mod) => ({ default: mod.CitationRenderer })))

const COLLAPSE_CHAR_THRESHOLD = 350

export const UserMessageBubble: React.FC<{ content: string }> = ({ content }) => {
    const lineCount = (content.match(/\n/g) ?? []).length + 1
    const isLong = content.length > COLLAPSE_CHAR_THRESHOLD || lineCount > 8
    const [collapsed, setCollapsed] = React.useState(isLong)

    return (
        <div>
            <div className="relative">
                <div
                    className={cn(
                        'rounded-2xl rounded-br-md border border-user-bubble-border bg-user-bubble px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words sm:px-5 sm:py-3',
                        collapsed && 'max-h-[7.5rem] overflow-hidden',
                    )}
                    style={{ boxShadow: 'var(--shadow-soft)', overflowWrap: 'anywhere' }}
                >
                    {content}
                </div>
                {collapsed && <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-10 rounded-b-2xl rounded-br-md" style={{ background: 'linear-gradient(to top, var(--color-user-bubble), transparent)' }} />}
            </div>
            {isLong && (
                <button type="button" onClick={() => setCollapsed((value) => !value)} className="ml-auto mt-1 flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-secondary cursor-pointer">
                    <ChevronDown size={12} className={cn('transition-transform duration-200', !collapsed && 'rotate-180')} />
                    <span>{collapsed ? '展开' : '收起'}</span>
                </button>
            )}
        </div>
    )
}

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

export const MD: React.FC<{ content: string }> = ({ content }) => (
    <React.Suspense fallback={<MarkdownLoading />}>
        {contentMayContainMath(content) ? <MarkdownMathRenderer content={content} /> : <MarkdownRenderer content={content} />}
    </React.Suspense>
)

export const CitedMD: React.FC<{ content: string; sources?: Message['citations'] }> = ({ content, sources }) => (
    <React.Suspense fallback={<MarkdownLoading />}>
        <CitationRenderer content={content} sources={sources} />
    </React.Suspense>
)

export const MessageSkeleton: React.FC = () => (
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

export const TypingIndicator: React.FC = () => (
    <div className="mb-3 rounded-2xl border border-border bg-fill-secondary/60 p-4 backdrop-blur-sm" style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
            </div>
            <span className="ml-1 text-xs text-text-tertiary">{t('thinking')}</span>
        </div>
    </div>
)

const TodoIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'completed':
            return <CheckCircle2 size={14} className="shrink-0 text-success" />
        case 'in-progress':
            return <Loader2 size={14} className="shrink-0 animate-spin text-primary-mint" />
        default:
            return <Circle size={14} className="shrink-0 text-text-quaternary" />
    }
}

export const TodoPanel: React.FC<{ todos: AgentTodoItem[] }> = ({ todos }) => {
    const completed = todos.filter((todo) => todo.status === 'completed').length
    const total = todos.length
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0

    return (
        <div className="my-3 overflow-hidden rounded-2xl border border-border bg-fill-secondary/60 backdrop-blur-sm" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-text-secondary">
                <span className="font-semibold">{t('tasks')}</span>
                <span className="text-text-tertiary">{completed}/{total}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary-mint to-emerald-500 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
                </div>
            </div>
            <div className="space-y-1 px-4 pb-3">
                {todos.map((todo) => (
                    <div key={todo.id} className={cn('flex items-center gap-2.5 py-1 text-xs transition-all duration-300', todo.status === 'completed' ? 'text-text-tertiary line-through opacity-60' : 'text-text')}>
                        <TodoIcon status={todo.status} />
                        <span>{todo.title}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export const ScrollToBottom: React.FC<{ onClick: () => void; visible: boolean }> = ({ onClick, visible }) => (
    <button
        onClick={onClick}
        className={cn(
            'absolute right-6 bottom-28 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg-container transition-all duration-300',
            visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
        style={{ boxShadow: 'var(--shadow-elevated)' }}
    >
        <ChevronDown size={16} className="text-text-secondary" />
    </button>
)

export const FileAttachmentIcon: React.FC<{ filename: string; className?: string }> = ({ filename, className }) => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'pdf') return <FileText size={14} className={className ?? 'text-red-400'} />
    if (ext === 'docx' || ext === 'doc') return <FileText size={14} className={className ?? 'text-blue-400'} />
    if (ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet size={14} className={className ?? 'text-green-400'} />
    return <FileIcon size={14} className={className ?? 'text-text-tertiary'} />
}
