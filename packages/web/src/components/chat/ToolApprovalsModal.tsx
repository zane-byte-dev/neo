import React from 'react'
import { Loader2, X } from 'lucide-react'
import {
    deleteToolApproval as deleteToolApprovalApi,
    fetchToolApprovals,
    type ToolApprovalRule,
} from '../../api'
import { t } from '../../i18n'
import { cn } from '../../lib/utils'
import { confirm as confirmDialog } from '../ConfirmDialog'
import { toast } from '../Toast'

function compactPreview(text: string, max = 96): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
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

export const ToolApprovalsModal: React.FC<{
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
                                                    {rule.matchMode === 'tool' && (
                                                        <span className="px-2 py-0.5 rounded-full border border-primary-mint/20 bg-primary-mint/8 text-[10px] font-medium text-primary-mint">
                                                            {t('toolApprovalMatchTool')}
                                                        </span>
                                                    )}
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
