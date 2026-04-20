import React from 'react'
import { fetchModels, fetchModelMessages, type ModelsResponse, type ModelInfo, type UsageRecord, type SessionMessage } from '../api'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import type { TranslationKeys } from '../i18n/locales/en'

// ── helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
    google: 'Google Gemini',
    'gemini-acp': 'Gemini CLI (ACP)',
    deepseek: 'DeepSeek',
    ollama: 'Ollama (Local)',
}

const TIER_COLORS: Record<string, string> = {
    simple: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    standard: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    complex: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

type T = (key: TranslationKeys, params?: Record<string, string | number>) => string

function formatCost(usd: number, t: T): string {
    if (usd === 0) return t('free')
    if (usd < 0.01) return `$${usd.toFixed(4)}`
    return `$${usd.toFixed(2)}`
}

function timeAgo(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return `${sec}s ago`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
    return `${Math.floor(sec / 86400)}d ago`
}

// ── Model Card ───────────────────────────────────────────────────────────────

const ModelCard: React.FC<{
    model: ModelInfo
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number; callCount: number }
    t: T
}> = ({ model, usage, t }) => (
    <div className="bg-bg-container border border-border rounded-xl p-4 hover:border-primary-mint/40 transition-colors"
         style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-start justify-between mb-2.5">
            <div>
                <h3 className="text-sm font-semibold text-text">{model.alias}</h3>
                <p className="text-xs text-text-tertiary mt-0.5 font-mono">{model.modelId}</p>
            </div>
            <span className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-medium',
                model.free
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            )}>
                {model.free ? t('free') : t('paid')}
            </span>
        </div>

        <p className="text-xs text-text-secondary mb-3">
            {PROVIDER_LABELS[model.provider] ?? model.provider}
        </p>

        {/* Pricing */}
        {!model.free && (
            <div className="text-[11px] text-text-tertiary mb-3 space-y-0.5">
                <div>Input: <span className="text-text-secondary font-medium">${model.pricing.input}/1K tokens</span></div>
                <div>Output: <span className="text-text-secondary font-medium">${model.pricing.output}/1K tokens</span></div>
            </div>
        )}

        {/* Tiers */}
        <div className="flex flex-wrap gap-1.5 mb-3">
            {model.tiers.map((t) => (
                <span key={t} className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TIER_COLORS[t] ?? 'bg-fill text-text-secondary')}>
                    {t}
                </span>
            ))}
            {model.tiers.length === 0 && (
                <span className="text-[10px] text-text-quaternary">{t('noAutoTier')}</span>
            )}
        </div>

        {/* Usage stats */}
        {usage && (
            <div className="border-t border-border-secondary pt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-text-tertiary">{t('calls')}</div>
                <div className="text-text-secondary font-medium text-right">{usage.callCount}</div>
                <div className="text-text-tertiary">{t('tokens')}</div>
                <div className="text-text-secondary font-medium text-right">{formatTokens(usage.totalTokens)}</div>
            </div>
        )}
    </div>
)

// ── Usage Summary ────────────────────────────────────────────────────────────

const UsageSummary: React.FC<{ data: ModelsResponse; t: T }> = ({ data, t }) => {
    const { usage, dailyCost, dailyCostLimit } = data
    const stats = [
        { label: t('totalCalls'), value: String(usage.callCount) },
        { label: t('totalTokens'), value: formatTokens(usage.totalTokens) },
        { label: t('promptTokens'), value: formatTokens(usage.totalPromptTokens) },
        { label: t('completionTokens'), value: formatTokens(usage.totalCompletionTokens) },
        { label: t('todayCost'), value: formatCost(dailyCost, t) },
        { label: t('dailyLimit'), value: dailyCostLimit > 0 ? formatCost(dailyCostLimit, t) : t('unlimited') },
    ]

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {stats.map((s) => (
                <div key={s.label} className="bg-bg-container border border-border rounded-xl p-3 text-center"
                     style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <div className="text-lg font-bold text-text">{s.value}</div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">{s.label}</div>
                </div>
            ))}
        </div>
    )
}

// ── Routing Config ───────────────────────────────────────────────────────────

const RoutingConfig: React.FC<{ data: ModelsResponse; t: T }> = ({ data, t }) => {
    const { routing } = data

    return (
        <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <h2 className="text-sm font-semibold text-text mb-3">{t('routingConfig')}</h2>

            {/* Tier chains */}
            <div className="space-y-2 mb-4">
                {Object.entries(routing.tiers).map(([tier, models]) => (
                    <div key={tier} className="flex items-center gap-2">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium w-16 text-center', TIER_COLORS[tier])}>
                            {tier}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-text-secondary">
                            {(models as string[]).map((m, i) => (
                                <React.Fragment key={m}>
                                    {i > 0 && <span className="text-text-quaternary">→</span>}
                                    <span className="bg-fill px-1.5 py-0.5 rounded font-mono text-[11px]">{m}</span>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Boundaries & overrides */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div className="bg-fill-secondary rounded-lg p-3 space-y-1">
                    <div className="font-medium text-text-secondary text-xs mb-1.5">{t('scoreBoundaries')}</div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('simpleMax')}</span>
                        <span className="text-text-secondary font-mono">{routing.boundaries.simpleMax}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('standardMax')}</span>
                        <span className="text-text-secondary font-mono">{routing.boundaries.standardMax}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('confidenceK')}</span>
                        <span className="text-text-secondary font-mono">{routing.confidence.k}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('fallbackThreshold')}</span>
                        <span className="text-text-secondary font-mono">{routing.confidence.fallbackThreshold}</span>
                    </div>
                </div>
                <div className="bg-fill-secondary rounded-lg p-3 space-y-1">
                    <div className="font-medium text-text-secondary text-xs mb-1.5">{t('overrides')}</div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('toolFloor')}</span>
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', TIER_COLORS[routing.overrides.toolFloor])}>
                            {routing.overrides.toolFloor}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('largeCtxFloor')}</span>
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', TIER_COLORS[routing.overrides.largeContextFloor])}>
                            {routing.overrides.largeContextFloor}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('ctxThreshold')}</span>
                        <span className="text-text-secondary font-mono">{formatTokens(routing.overrides.largeContextThreshold)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-text-tertiary">{t('momentumWindow')}</span>
                        <span className="text-text-secondary font-mono">{t('turns', { n: routing.momentum.historySize })}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── History Table ─────────────────────────────────────────────────────────────

const HistoryTable: React.FC<{ records: UsageRecord[]; t: T; onViewDetail: (r: UsageRecord) => void }> = ({ records, t, onViewDetail }) => {
    if (records.length === 0) {
        return (
            <div className="bg-bg-container border border-border rounded-xl p-6 text-center text-text-tertiary text-sm">
                {t('noHistoryYet')}
            </div>
        )
    }

    return (
        <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="bg-fill-secondary border-b border-border text-text-tertiary">
                            <th className="px-3 py-2 text-left font-medium">{t('colTime')}</th>
                            <th className="px-3 py-2 text-left font-medium">{t('colModel')}</th>
                            <th className="px-3 py-2 text-left font-medium">{t('colTier')}</th>
                            <th className="px-3 py-2 text-right font-medium">{t('colScore')}</th>
                            <th className="px-3 py-2 text-right font-medium">{t('colTokens')}</th>
                            <th className="px-3 py-2 text-right font-medium">{t('colCost')}</th>
                            <th className="px-3 py-2 text-right font-medium">{t('colDuration')}</th>
                            <th className="px-3 py-2 text-left font-medium">{t('colReason')}</th>
                            <th className="px-3 py-2 text-center font-medium w-16"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.map((r, i) => (
                            <tr key={i} className="border-b border-border-secondary last:border-0 hover:bg-fill-secondary/50 transition-colors">
                                <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{timeAgo(r.timestamp)}</td>
                                <td className="px-3 py-2 font-mono text-text-secondary">
                                    {r.model}
                                    {r.fallbackUsed && r.originalModel && (
                                        <span className="ml-1 text-warning text-[10px]">(fb: {r.originalModel})</span>
                                    )}
                                </td>
                                <td className="px-3 py-2">
                                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', TIER_COLORS[r.tier])}>
                                        {r.tier}
                                    </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-text-secondary">{r.score.toFixed(3)}</td>
                                <td className="px-3 py-2 text-right font-mono text-text-secondary">{formatTokens(r.totalTokens)}</td>
                                <td className="px-3 py-2 text-right font-mono text-text-secondary">{formatCost(r.estimatedCost, t)}</td>
                                <td className="px-3 py-2 text-right font-mono text-text-secondary">{r.durationMs > 0 ? `${(r.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                                <td className="px-3 py-2 text-text-tertiary">{r.reason}</td>
                                <td className="px-3 py-2 text-center">
                                    <button
                                        onClick={() => onViewDetail(r)}
                                        className="px-2 py-0.5 rounded text-[10px] font-medium text-primary-mint hover:bg-primary-mint/10 transition-colors"
                                    >
                                        {t('viewDetails')}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

const DetailModal: React.FC<{
    record: UsageRecord
    t: T
    onClose: () => void
}> = ({ record, t, onClose }) => {
    const [messages, setMessages] = React.useState<SessionMessage[] | null>(null)
    const [msgLoading, setMsgLoading] = React.useState(false)
    const [msgError, setMsgError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!record.sessionId) return
        setMsgLoading(true)
        setMsgError(null)
        fetchModelMessages(record.sessionId)
            .then((res) => setMessages(res.messages))
            .catch((e: Error) => setMsgError(e.message))
            .finally(() => setMsgLoading(false))
    }, [record.sessionId])

    // Close on Escape
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const ts = new Date(record.timestamp)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
            <div
                className="bg-bg-container border border-border rounded-2xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col"
                style={{ boxShadow: 'var(--shadow-float)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                    <h2 className="text-sm font-semibold text-text">{t('usageDetail')}</h2>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text text-lg leading-none px-1">&times;</button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                    {/* Metadata grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
                        {[
                            [t('colTime'), ts.toLocaleString()],
                            [t('colModel'), record.model],
                            [t('colTier'), record.tier],
                            [t('colScore'), record.score.toFixed(3)],
                            ['Confidence', record.confidence.toFixed(2)],
                            [t('colReason'), record.reason],
                            [t('promptTokens'), formatTokens(record.promptTokens)],
                            [t('completionTokens'), formatTokens(record.completionTokens)],
                            [t('totalTokens'), formatTokens(record.totalTokens)],
                            [t('colCost'), formatCost(record.estimatedCost, t)],
                            [t('colDuration'), record.durationMs > 0 ? `${(record.durationMs / 1000).toFixed(1)}s` : '-'],
                            [t('session'), record.sessionId ?? '-'],
                            ...(record.fallbackUsed ? [['Fallback from', record.originalModel ?? '-']] : []),
                        ].map(([label, value]) => (
                            <div key={label as string} className="flex justify-between sm:flex-col gap-0.5">
                                <span className="text-text-tertiary">{label}</span>
                                <span className="text-text-secondary font-medium font-mono text-right sm:text-left break-all">{value}</span>
                            </div>
                        ))}
                    </div>

                    {/* Chat messages */}
                    <div>
                        <h3 className="text-xs font-semibold text-text mb-2">{t('chatMessages')}</h3>
                        {!record.sessionId ? (
                            <p className="text-xs text-text-tertiary">{t('noSession')}</p>
                        ) : msgLoading ? (
                            <p className="text-xs text-text-tertiary">{t('loadingMessages')}</p>
                        ) : msgError ? (
                            <p className="text-xs text-destructive">{msgError}</p>
                        ) : !messages?.length ? (
                            <p className="text-xs text-text-tertiary">{t('noMessages')}</p>
                        ) : (
                            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                                {messages.map((msg) => (
                                    <div key={msg.id} className={cn(
                                        'rounded-lg p-3 text-xs',
                                        msg.role === 'user' || msg.role === 'human'
                                            ? 'bg-user-bubble border border-user-bubble-border'
                                            : 'bg-fill-secondary border border-border-secondary'
                                    )}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-semibold text-text">
                                                {msg.role === 'user' || msg.role === 'human' ? t('user') : t('assistant')}
                                            </span>
                                            <span className="text-[10px] text-text-quaternary">
                                                {new Date(msg.timestamp).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words text-text-secondary font-mono text-[11px] leading-relaxed max-h-60 overflow-y-auto">
                                            {msg.content}
                                        </pre>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-fill border border-border rounded-lg text-xs text-text-secondary hover:bg-fill-secondary transition-colors"
                    >
                        {t('close')}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export const ModelPanel: React.FC = () => {
    const t = useT()
    const [data, setData] = React.useState<ModelsResponse | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [month, setMonth] = React.useState(() => new Date().toISOString().slice(0, 7))
    const [detailRecord, setDetailRecord] = React.useState<UsageRecord | null>(null)

    const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetchModels(month)
            setData(res)
        } catch (e: unknown) {
            setError((e as Error).message ?? t('loadFailed'))
        } finally {
            setLoading(false)
        }
    }, [month])

    React.useEffect(() => { load() }, [load])

    if (loading && !data) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-1.5">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                </div>
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-text-secondary text-sm mb-3">{error}</p>
                    <button onClick={load} className="px-4 py-2 bg-primary-mint text-white rounded-lg text-xs font-medium hover:opacity-90">
                        {t('retry')}
                    </button>
                </div>
            </div>
        )
    }

    if (!data) return null

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold text-text">{t('models')}</h1>
                        <p className="text-xs text-text-tertiary mt-0.5">{t('modelsSubtitle')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="month"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="bg-fill border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary outline-none focus:border-primary-mint"
                        />
                        <button
                            onClick={load}
                            disabled={loading}
                            className="px-3 py-1.5 bg-fill border border-border rounded-lg text-xs text-text-secondary hover:bg-fill-secondary transition-colors disabled:opacity-50"
                        >
                            {loading ? '...' : t('refresh')}
                        </button>
                    </div>
                </div>

                {/* Usage Summary */}
                <section>
                    <h2 className="text-sm font-semibold text-text mb-2.5">{t('usageOverview')} — {data.usage.month}</h2>
                    <UsageSummary data={data} t={t} />
                </section>

                {/* Model Cards */}
                <section>
                    <h2 className="text-sm font-semibold text-text mb-2.5">{t('availableModels')}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {data.models.map((m) => (
                            <ModelCard key={m.alias} model={m} usage={data.usage.byModel[m.modelId]} t={t} />
                        ))}
                    </div>
                </section>

                {/* Routing Config */}
                <section>
                    <RoutingConfig data={data} t={t} />
                </section>

                {/* History */}
                <section>
                    <h2 className="text-sm font-semibold text-text mb-2.5">{t('recentHistory')}</h2>
                    <HistoryTable records={data.history} t={t} onViewDetail={setDetailRecord} />
                </section>
            </div>

            {/* Detail Modal */}
            {detailRecord && (
                <DetailModal record={detailRecord} t={t} onClose={() => setDetailRecord(null)} />
            )}
        </div>
    )
}
