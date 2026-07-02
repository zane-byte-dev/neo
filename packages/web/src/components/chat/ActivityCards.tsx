import React from 'react'
import { CheckCircle2, ChevronDown, FileText, Globe, Loader2, Terminal, Wrench } from 'lucide-react'
import { confirmTool, fetchToolResult } from '../../api'
import { t } from '../../i18n'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/useAppStore'
import type { ActivityItem } from '../../types'
import {
    activityPreviewText,
    compactPreview,
    FILE_TOOLS,
    generateBatchSummary,
    mergeActivityItems,
    RUN_TOOLS,
    semanticPreview,
    toolDisplayName,
    type ActivityDisplayItem,
    WEB_TOOLS,
} from './activity-utils'

export function ToolIcon({ toolName, className }: { toolName: string; className?: string }) {
    if (RUN_TOOLS.has(toolName)) return <Terminal size={11} className={className} />
    if (FILE_TOOLS.has(toolName)) return <FileText size={11} className={className} />
    if (WEB_TOOLS.has(toolName)) return <Globe size={11} className={className} />
    return <Wrench size={11} className={className} />
}

const AskUserCard: React.FC<{ item: ActivityItem }> = ({ item }) => {
    const setPendingQuickReply = useAppStore((state) => state.setPendingQuickReply)
    const activeChatId = useAppStore((state) => state.activeChatId)
    const isGenerating = useAppStore((state) => (activeChatId ? !!state.generatingBySession[activeChatId] : false))

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
        <div className="my-3 rounded-2xl border border-primary-mint/30 bg-primary-mint/5 px-4 py-3.5" style={{ boxShadow: 'var(--shadow-soft)' }}>
            {context && <p className="mb-2 text-xs leading-relaxed text-text-tertiary">{context}</p>}
            <p className="mb-3 text-sm font-medium leading-relaxed text-text">❓ {question}</p>
            {options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {options.map((option, index) => (
                        <button
                            key={index}
                            type="button"
                            disabled={isGenerating}
                            onClick={() => handleSelect(option)}
                            className={cn(
                                'rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-150',
                                isGenerating
                                    ? 'cursor-not-allowed border-border text-text-tertiary opacity-50'
                                    : 'cursor-pointer border-primary-mint/40 bg-primary-mint/8 text-primary-mint hover:border-primary-mint/60 hover:bg-primary-mint/15 active:scale-95',
                            )}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export const ActivityItemCard: React.FC<{
    item: ActivityItem
    resultItem?: ActivityItem
    sessionId?: string | null
    compact?: boolean
}> = ({ item, resultItem, sessionId, compact }) => {
    const [expandedResult, setExpandedResult] = React.useState<string | null>(null)
    const [expanding, setExpanding] = React.useState(false)
    const [showDetails, setShowDetails] = React.useState(false)
    const updateActivityConfirmStatus = useAppStore((state) => state.updateActivityConfirmStatus)
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
    const StatusIcon = status === 'pending'
        ? () => <span className="shrink-0 text-[11px] text-warning">⚠</span>
        : isBlocked
            ? () => <span className="shrink-0 text-[11px] text-warning">⚠</span>
            : targetResult || item.type === 'tool_result' || status === 'approved'
                ? () => <CheckCircle2 size={11} className="shrink-0 text-success" />
                : () => <Loader2 size={11} className="shrink-0 animate-spin text-primary-mint" />

    const handleConfirm = async (confirmId: string, approved: boolean, approvalScope: 'once' | 'session' | 'always' = 'once') => {
        if (!sessionId) return
        updateActivityConfirmStatus(sessionId, confirmId, approved ? 'submitted' : 'denied', approved ? approvalScope : undefined)
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
        }
    }

    const handleExpand = async (resultId: string) => {
        if (expandedResult || expanding) return
        setExpanding(true)
        try {
            const full = await fetchToolResult(resultId)
            setExpandedResult(full.result)
        } catch {
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
        let askOptions: string[] = []
        try {
            const parsed = JSON.parse(String(item.args?.options ?? '[]'))
            if (Array.isArray(parsed)) askOptions = parsed.map(String)
        } catch {
        }
        if (askOptions.length > 0) return <AskUserCard item={item} />
    }

    if (item.type === 'tool_confirm') {
        return (
            <div
                className={cn('my-1.5 rounded-xl border px-3 py-2 text-xs transition-colors duration-150', tone, needsDetails && 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}
                style={{ boxShadow: 'var(--shadow-soft)' }}
                onClick={needsDetails ? toggleDetails : undefined}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <StatusIcon />
                    <ToolIcon toolName={item.toolName} className="shrink-0 text-text-tertiary" />
                    <span className="shrink-0 font-medium text-text-secondary">{toolDisplayName(item.toolName)}</span>
                    {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                    {needsDetails && <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', showDetails && 'rotate-180')} />}
                </div>
                {status === 'pending' ? (
                    <div className="flex flex-wrap gap-2 pt-2.5 pl-5">
                        <button type="button" onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'once')} className="rounded-lg bg-primary-mint px-2.5 py-1 text-[11px] text-white transition hover:opacity-90">{t('toolApproveOnce')}</button>
                        <button type="button" onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'session')} className="rounded-lg bg-fill-tertiary px-2.5 py-1 text-[11px] text-text-secondary transition hover:bg-fill-quaternary">{t('toolApproveSession')}</button>
                        <button type="button" onClick={() => item.confirmId && handleConfirm(item.confirmId, true, 'always')} className="rounded-lg bg-fill-tertiary px-2.5 py-1 text-[11px] text-text-secondary transition hover:bg-fill-quaternary">{t('toolApproveAlways')}</button>
                        <button type="button" onClick={() => item.confirmId && handleConfirm(item.confirmId, false)} className="rounded-lg border border-border bg-transparent px-2.5 py-1 text-[11px] text-text-secondary transition hover:bg-fill">{t('toolDeny')}</button>
                    </div>
                ) : null}
                {showDetails && needsDetails && (
                    <div className="mt-2 space-y-2" onClick={(event) => event.stopPropagation()}>
                        {inputText && (
                            <div className="pl-3">
                                <div className="mb-1 text-[10px] font-medium text-text-quaternary">输入</div>
                                <div className="whitespace-pre-wrap break-words border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary">{inputText}</div>
                            </div>
                        )}
                        {outputText && (
                            <div className="pl-3">
                                <div className="mb-1 text-[10px] font-medium text-text-quaternary">输出</div>
                                <div className="whitespace-pre-wrap break-words border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary">{outputText}</div>
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
            className={cn('my-1.5 rounded-xl border px-3 py-2 text-xs transition-colors duration-150', tone, needsDetails && 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}
            style={compact ? undefined : { boxShadow: 'var(--shadow-soft)' }}
            onClick={needsDetails ? toggleDetails : undefined}
            onKeyDown={needsDetails ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleDetails()
                }
            } : undefined}
        >
            <div className="flex min-w-0 items-center gap-2">
                <StatusIcon />
                <ToolIcon toolName={item.toolName} className="shrink-0 text-text-tertiary" />
                <span className="shrink-0 font-medium text-text-secondary">{toolDisplayName(item.toolName)}</span>
                {preview && <span className="min-w-0 flex-1 truncate text-text-tertiary">{preview}</span>}
                {needsDetails && <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', showDetails && 'rotate-180')} />}
            </div>
            {showDetails && needsDetails && (
                <div className="mt-2 space-y-2" onClick={(event) => event.stopPropagation()}>
                    {inputText && (
                        <div className="pl-3">
                            <div className="mb-1 text-[10px] font-medium text-text-quaternary">输入</div>
                            <div className="whitespace-pre-wrap break-words border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary">{inputText}</div>
                        </div>
                    )}
                    {outputText && (
                        <div className="pl-3">
                            <div className="mb-1 text-[10px] font-medium text-text-quaternary">输出</div>
                            <div className="whitespace-pre-wrap break-words border-l-2 border-border/50 pl-3 font-mono text-[11px] text-text-tertiary">{outputText}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export const ActivityFeed: React.FC<{ items: ActivityItem[]; sessionId?: string | null }> = ({ items, sessionId }) => (
    <div className="mb-3">
        {mergeActivityItems(items).map(({ item, resultItem }, index) => (
            <ActivityItemCard
                key={`${item.type}-${item.confirmId ?? item.resultId ?? item.timestamp}-${resultItem?.resultId ?? 'none'}-${index}`}
                item={item}
                resultItem={resultItem}
                sessionId={sessionId}
            />
        ))}
    </div>
)

export const ActivityBatchCard: React.FC<{ items: ActivityDisplayItem[]; sessionId?: string | null }> = ({ items, sessionId }) => {
    const [expanded, setExpanded] = React.useState(false)
    const summary = generateBatchSummary(items)
    const hasConfirm = items.some((displayItem) => displayItem.item.type === 'tool_confirm' && (!displayItem.item.confirmStatus || displayItem.item.confirmStatus === 'pending'))
    const hasBlocked = items.some((displayItem) => displayItem.resultItem?.result?.startsWith('[BLOCKED]'))
    const allSettled = items.every((displayItem) => displayItem.resultItem || displayItem.item.type === 'tool_result' || (displayItem.item.type === 'tool_confirm' && displayItem.item.confirmStatus && displayItem.item.confirmStatus !== 'pending'))
    const tone = hasConfirm ? 'border-warning/30 bg-warning/5' : hasBlocked ? 'border-warning/20 bg-warning/5' : 'border-border/50 bg-fill-secondary/25'

    return (
        <div className={cn('my-2 overflow-hidden rounded-xl border text-xs transition-colors duration-150', tone)} style={{ boxShadow: 'var(--shadow-soft)' }}>
            <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 transition-colors hover:brightness-95 dark:hover:brightness-110"
                onClick={() => setExpanded((value) => !value)}
            >
                {hasConfirm ? (
                    <span className="shrink-0 text-[11px] text-warning">⚠</span>
                ) : allSettled ? (
                    <CheckCircle2 size={11} className="shrink-0 text-success" />
                ) : (
                    <Loader2 size={11} className="shrink-0 animate-spin text-primary-mint" />
                )}
                <span className="min-w-0 flex-1 truncate text-left font-medium text-text-secondary">{summary}</span>
                {items.length > 1 && <span className="shrink-0 rounded-full bg-fill-tertiary px-1.5 py-0.5 text-[10px] tabular-nums text-text-quaternary">{items.length}</span>}
                <ChevronDown size={11} className={cn('shrink-0 text-text-quaternary transition-transform duration-200', expanded && 'rotate-180')} />
            </button>
            {expanded && (
                <div className="space-y-0.5 border-t border-border/40 px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                    {items.map(({ item, resultItem }, index) => (
                        <ActivityItemCard
                            key={`${item.type}-${item.confirmId ?? item.resultId ?? item.timestamp}-${resultItem?.resultId ?? 'none'}-${index}`}
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
