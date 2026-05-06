import React from 'react'
import {
    deleteToolApproval,
    fetchModels,
    fetchModelMessages,
    fetchPreferences,
    fetchSecrets,
    fetchToolApprovals,
    resetRouting,
    saveRouting,
    savePreferences,
    saveSecrets,
    type ModelsResponse,
    type ModelInfo,
    type ProviderStatus,
    type RoutingConfigData,
    type RoutingTier,
    type SecretKey,
    type SecretStatus,
    type ToolApprovalRule,
    type UsageRecord,
    type SessionMessage,
    type UserPreferences,
    type TelegramRuntimeInfo,
} from '../api'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import type { TranslationKeys } from '../i18n/locales/en'

// ── helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
    google: 'Google Gemini',
    'gemini-acp': 'Gemini CLI (ACP)',
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
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

function timeAgo(ts: number, t: T): string {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return t('timeAgoSeconds', { n: sec })
    if (sec < 3600) return t('timeAgoMinutes', { n: Math.floor(sec / 60) })
    if (sec < 86400) return t('timeAgoHours', { n: Math.floor(sec / 3600) })
    return t('timeAgoDays', { n: Math.floor(sec / 86400) })
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

// ── Telegram Control ─────────────────────────────────────────────────────────

const TelegramControlCard: React.FC<{
    preferences: UserPreferences
    runtime: TelegramRuntimeInfo
    loading: boolean
    saving: boolean
    error: string | null
    t: T
    onToggle: () => void
}> = ({ preferences, runtime, loading, saving, error, t, onToggle }) => {
    const enabled = Boolean(preferences.telegramBotEnabled)
    const disabled = loading || saving

    let statusText = t('telegramBotStopped')
    let statusTone = 'bg-fill text-text-secondary'
    if (!runtime.configured) {
        statusText = t('telegramBotUnavailable')
        statusTone = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    } else if (runtime.active && enabled) {
        statusText = t('telegramBotRunning')
        statusTone = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    } else if (runtime.active) {
        statusText = t('telegramBotRunningShared')
        statusTone = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    }

    return (
        <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                        <h2 className="text-sm font-semibold text-text">{t('telegramBot')}</h2>
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', statusTone)}>{loading ? '...' : statusText}</span>
                    </div>
                    <p className="text-xs text-text-tertiary leading-relaxed">
                        {t('telegramBotDescription')}
                    </p>
                    {error && (
                        <p className="text-[11px] text-destructive mt-2">{error}</p>
                    )}
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={t('telegramBot')}
                    disabled={disabled}
                    onClick={onToggle}
                    className={cn(
                        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200',
                        enabled ? 'bg-primary-mint border-primary-mint' : 'bg-fill border-border',
                        disabled && 'cursor-not-allowed opacity-60',
                    )}
                >
                    <span
                        className={cn(
                            'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                            enabled ? 'translate-x-6' : 'translate-x-1',
                        )}
                    />
                </button>
            </div>
        </div>
    )
}

// ── Credentials ──────────────────────────────────────────────────────────────

interface SecretFieldDef {
    key: SecretKey
    label: string
    placeholder: string
    models?: string[]
}

const MODEL_SECRET_FIELDS: SecretFieldDef[] = [
    { key: 'GEMINI_API_KEY',    label: 'Gemini API Key',    placeholder: 'AIza…', models: ['flash', 'pro'] },
    { key: 'DEEPSEEK_API_KEY',  label: 'DeepSeek API Key',  placeholder: 'sk-…', models: ['deepseek', 'deepseek-reasoner'] },
    { key: 'OPENAI_API_KEY',    label: 'OpenAI API Key',    placeholder: 'sk-…', models: ['gpt', 'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini'] },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', placeholder: 'sk-ant-…', models: ['claude', 'claude-sonnet', 'claude-opus', 'claude-haiku'] },
]

const TELEGRAM_SECRET_FIELDS: SecretFieldDef[] = [
    { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', placeholder: '1234:ABC…' },
    { key: 'TELEGRAM_CHAT_ID',   label: 'Telegram Chat ID',   placeholder: '123456789' },
]

const MODEL_PROVIDER_SECRET_KEYS = new Set<SecretKey>(MODEL_SECRET_FIELDS.map((field) => field.key))

const SecretFieldsEditor: React.FC<{
    fields: SecretFieldDef[]
    statuses: Record<SecretKey, SecretStatus> | null
    loading: boolean
    savingKey: SecretKey | null
    helperText: string
    onSave: (key: SecretKey, value: string) => void
    t: T
}> = ({ fields, statuses, loading, savingKey, helperText, onSave, t }) => {
    const [drafts, setDrafts] = React.useState<Partial<Record<SecretKey, string>>>({})

    return (
        <div className="space-y-2">
            {fields.map(({ key, label, placeholder, models }) => {
                    const status = statuses?.[key]
                    const draft = drafts[key] ?? ''
                    const saving = savingKey === key
                    const sourceLabel = !status || status.source === 'none'
                        ? t('credentialsSourceNone')
                        : status.source === 'env'
                            ? t('credentialsSourceEnv')
                            : t('credentialsSourceFile')
                    const sourceTone = !status || status.source === 'none'
                        ? 'bg-fill text-text-tertiary'
                        : status.source === 'env'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'

                    return (
                        <div key={key} className="border border-border rounded-lg p-3 bg-fill/30">
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-text">{label}</span>
                                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', sourceTone)}>
                                        {loading ? '...' : sourceLabel}
                                    </span>
                                </div>
                                {status?.hasValue && status.masked && (
                                    <span className="text-[11px] text-text-tertiary font-mono">{status.masked}</span>
                                )}
                            </div>
                            {models?.length ? (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {models.map((model) => (
                                        <span key={model} className="px-2 py-0.5 rounded-full bg-bg-container border border-border-secondary text-[10px] font-mono text-text-secondary">
                                            {model}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <div className="flex items-center gap-2">
                                <input
                                    type="password"
                                    value={draft}
                                    placeholder={placeholder}
                                    onChange={(e) => setDrafts((current) => ({ ...current, [key]: e.target.value }))}
                                    className="flex-1 bg-bg-container border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-primary-mint font-mono"
                                />
                                <button
                                    type="button"
                                    disabled={saving || loading}
                                    onClick={() => {
                                        onSave(key, draft)
                                        setDrafts((current) => ({ ...current, [key]: '' }))
                                    }}
                                    className="px-3 py-1.5 bg-primary-mint text-white rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50"
                                >
                                    {saving ? '...' : t('credentialsSave')}
                                </button>
                                {status?.source === 'file' && (
                                    <button
                                        type="button"
                                        disabled={saving || loading}
                                        onClick={() => onSave(key, '')}
                                        className="px-3 py-1.5 bg-fill border border-border text-text-secondary rounded-md text-xs hover:bg-fill-secondary disabled:opacity-50"
                                    >
                                        {t('credentialsClear')}
                                    </button>
                                )}
                            </div>
                            <p className="text-[10px] text-text-tertiary mt-1.5">{helperText}</p>
                        </div>
                    )
                })}
        </div>
    )
}

const CredentialsCard: React.FC<{
    title: string
    description: string
    fields: SecretFieldDef[]
    statuses: Record<SecretKey, SecretStatus> | null
    loading: boolean
    savingKey: SecretKey | null
    error: string | null
    t: T
    onSave: (key: SecretKey, value: string) => void
}> = ({ title, description, fields, statuses, loading, savingKey, error, t, onSave }) => {
    return (
        <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div>
                <h2 className="text-sm font-semibold text-text">{title}</h2>
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{description}</p>
                {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
            </div>

            <SecretFieldsEditor
                fields={fields}
                statuses={statuses}
                loading={loading}
                savingKey={savingKey}
                helperText={t('credentialsPlaceholder')}
                onSave={onSave}
                t={t}
            />
        </div>
    )
}

const ToolApprovalsCard: React.FC<{
    rules: ToolApprovalRule[]
    loading: boolean
    deletingId: string | null
    error: string | null
    t: T
    onRevoke: (ruleId: string) => void
}> = ({ rules, loading, deletingId, error, t, onRevoke }) => {
    const renderSummary = (rule: ToolApprovalRule) => {
        if (rule.toolName === 'bash' && typeof rule.args?.command === 'string') {
            return rule.args.command
        }
        if (rule.args && Object.keys(rule.args).length > 0) {
            return JSON.stringify(rule.args)
        }
        return rule.policyKey
    }

    return (
        <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="mb-3">
                <h2 className="text-sm font-semibold text-text">{t('toolApprovals')}</h2>
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{t('toolApprovalsSubtitle')}</p>
            </div>

            {error && <p className="text-[11px] text-destructive mb-3">{error}</p>}

            {loading ? (
                <div className="text-xs text-text-tertiary">...</div>
            ) : rules.length === 0 ? (
                <div className="text-xs text-text-tertiary">{t('noToolApprovals')}</div>
            ) : (
                <div className="space-y-2.5">
                    {rules.map((rule) => (
                        <div key={rule.id} className="rounded-xl border border-border-secondary bg-fill-secondary/60 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                        <span className="text-xs font-semibold text-text">{rule.toolName}</span>
                                        <span className={cn(
                                            'px-2 py-0.5 rounded-full text-[10px] font-medium',
                                            rule.scope === 'always'
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
                                        )}>
                                            {rule.scope === 'always' ? t('approvalScopeAlways') : t('approvalScopeSession')}
                                        </span>
                                    </div>
                                    <pre className="whitespace-pre-wrap break-words text-text-secondary font-mono text-[11px] leading-relaxed bg-bg-container border border-border-secondary rounded-lg p-2.5">
                                        {renderSummary(rule)}
                                    </pre>
                                    <div className="mt-2 text-[10px] text-text-quaternary flex flex-wrap gap-x-3 gap-y-1">
                                        <span>{new Date(rule.updatedAt).toLocaleString()}</span>
                                        {rule.scope === 'session' && rule.sessionId && (
                                            <span className="font-mono">session: {rule.sessionId}</span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRevoke(rule.id)}
                                    disabled={deletingId === rule.id}
                                    className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors disabled:opacity-50"
                                >
                                    {deletingId === rule.id ? '...' : t('revokeApproval')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
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
                                <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{timeAgo(r.timestamp, t)}</td>
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

                    {/* System Prompt */}
                    <div>
                        <h3 className="text-xs font-semibold text-text mb-2">{t('systemPrompt')}</h3>
                        {record.systemPrompt ? (
                            <pre className="whitespace-pre-wrap break-words text-text-secondary font-mono text-[11px] leading-relaxed bg-fill-secondary border border-border-secondary rounded-lg p-3 max-h-48 overflow-y-auto">
                                {record.systemPrompt}
                            </pre>
                        ) : (
                            <p className="text-xs text-text-tertiary">{t('noSystemPrompt')}</p>
                        )}
                    </div>

                    {/* Actual Prompt Sent */}
                    <div>
                        <h3 className="text-xs font-semibold text-text mb-2">{t('actualPrompt')}</h3>
                        {record.userPrompt ? (
                            <pre className="whitespace-pre-wrap break-words text-text-secondary font-mono text-[11px] leading-relaxed bg-fill-secondary border border-border-secondary rounded-lg p-3 max-h-48 overflow-y-auto">
                                {record.userPrompt}
                            </pre>
                        ) : (
                            <p className="text-xs text-text-tertiary">{t('noActualPrompt')}</p>
                        )}
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

const AddModelModal: React.FC<{
    open: boolean
    statuses: Record<SecretKey, SecretStatus> | null
    loading: boolean
    savingKey: SecretKey | null
    error: string | null
    t: T
    onClose: () => void
    onSave: (key: SecretKey, value: string) => void
}> = ({ open, statuses, loading, savingKey, error, t, onClose, onSave }) => {
    React.useEffect(() => {
        if (!open) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
            <div
                className="bg-bg-container border border-border rounded-2xl w-[92vw] max-w-3xl max-h-[85vh] flex flex-col"
                style={{ boxShadow: 'var(--shadow-float)' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border shrink-0">
                    <div>
                        <h2 className="text-sm font-semibold text-text">{t('addModel')}</h2>
                        <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{t('addModelDescription')}</p>
                    </div>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text text-lg leading-none px-1">&times;</button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
                    {error && <p className="text-[11px] text-destructive">{error}</p>}

                    <SecretFieldsEditor
                        fields={MODEL_SECRET_FIELDS}
                        statuses={statuses}
                        loading={loading}
                        savingKey={savingKey}
                        helperText={t('credentialsPlaceholder')}
                        onSave={onSave}
                        t={t}
                    />

                    <div className="rounded-xl border border-border-secondary bg-fill-secondary/60 p-4">
                        <h3 className="text-xs font-semibold text-text mb-1.5">{t('localModelsHintTitle')}</h3>
                        <p className="text-xs text-text-tertiary leading-relaxed">{t('localModelsHintDescription')}</p>
                    </div>
                </div>

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

// ── Provider Status ──────────────────────────────────────────────────────────

const PROVIDER_STATUS_LABEL: Record<ProviderStatus['provider'], string> = {
    google: 'Google Gemini',
    'gemini-acp': 'Gemini CLI (ACP)',
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    ollama: 'Ollama (Local)',
}

const ProviderStatusCard: React.FC<{
    statuses: ProviderStatus[]
    loading: boolean
    onRefresh: () => void
    t: T
}> = ({ statuses, loading, onRefresh, t }) => (
    <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
            <div>
                <h2 className="text-sm font-semibold text-text">{t('providerStatusTitle')}</h2>
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{t('providerStatusSubtitle')}</p>
            </div>
            <button
                onClick={onRefresh}
                disabled={loading}
                className="px-3 py-1.5 bg-fill border border-border rounded-lg text-xs text-text-secondary hover:bg-fill-secondary disabled:opacity-50 shrink-0"
            >
                {loading ? '...' : t('providerStatusRefresh')}
            </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {statuses.map((s) => (
                <div key={s.provider} className="rounded-lg border border-border-secondary bg-fill/40 p-3">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-text">{PROVIDER_STATUS_LABEL[s.provider] ?? s.provider}</span>
                        <span className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-medium',
                            s.ok
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                        )}>
                            {s.ok ? t('providerStatusOk') : t('providerStatusFail')}
                        </span>
                    </div>
                    {s.detail && <p className="text-[11px] text-text-tertiary leading-relaxed">{s.detail}</p>}
                </div>
            ))}
        </div>
    </div>
)

// ── Routing Editor ───────────────────────────────────────────────────────────

const TIERS: RoutingTier[] = ['simple', 'standard', 'complex']

const RoutingEditor: React.FC<{
    routing: RoutingConfigData
    onSaved: (next: RoutingConfigData) => void
    t: T
}> = ({ routing, onSaved, t }) => {
    const [draft, setDraft] = React.useState<RoutingConfigData>(routing)
    const [saving, setSaving] = React.useState(false)
    const [resetting, setResetting] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [savedFlash, setSavedFlash] = React.useState(false)

    React.useEffect(() => { setDraft(routing) }, [routing])

    const updateTier = (tier: RoutingTier, raw: string) => {
        const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
        setDraft((d) => ({ ...d, tiers: { ...d.tiers, [tier]: list } }))
    }

    const updateNumber = (path: 'boundaries.simpleMax' | 'boundaries.standardMax' | 'overrides.largeContextThreshold' | 'confidence.k' | 'confidence.fallbackThreshold' | 'momentum.historySize', raw: string) => {
        const n = Number(raw)
        if (!Number.isFinite(n)) return
        setDraft((d) => {
            const next = structuredClone(d)
            const [section, field] = path.split('.') as [keyof RoutingConfigData, string]
            const obj = next[section] as Record<string, number>
            obj[field] = n
            return next
        })
    }

    const updateFloor = (which: 'toolFloor' | 'largeContextFloor', value: RoutingTier) => {
        setDraft((d) => ({ ...d, overrides: { ...d.overrides, [which]: value } }))
    }

    const submit = async () => {
        setSaving(true)
        setError(null)
        try {
            const res = await saveRouting({
                tiers: draft.tiers,
                boundaries: draft.boundaries,
                overrides: draft.overrides,
                confidence: draft.confidence,
                momentum: { ...draft.momentum },
            })
            onSaved(res.routing)
            setSavedFlash(true)
            setTimeout(() => setSavedFlash(false), 1800)
        } catch (e) {
            setError((e as Error).message ?? t('routingSaveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const reset = async () => {
        setResetting(true)
        setError(null)
        try {
            const res = await resetRouting()
            onSaved(res.routing)
            setDraft(res.routing)
        } catch (e) {
            setError((e as Error).message ?? t('routingSaveFailed'))
        } finally {
            setResetting(false)
        }
    }

    const numField = (label: string, path: Parameters<typeof updateNumber>[0], value: number, step = '0.01') => (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] text-text-tertiary">{label}</span>
            <input
                type="number"
                step={step}
                value={value}
                onChange={(e) => updateNumber(path, e.target.value)}
                className="bg-bg-container border border-border rounded-md px-2 py-1.5 text-xs text-text font-mono outline-none focus:border-primary-mint"
            />
        </label>
    )

    return (
        <div className="bg-bg-container border border-border rounded-xl p-4 space-y-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div>
                <h2 className="text-sm font-semibold text-text">{t('routingConfig')}</h2>
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{t('routingEditorSubtitle')}</p>
                {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
                {savedFlash && <p className="text-[11px] text-emerald-600 mt-2">{t('routingSaved')}</p>}
            </div>

            {/* Tier chains */}
            <div className="space-y-2">
                {TIERS.map((tier) => (
                    <label key={tier} className="block">
                        <div className="flex items-center gap-2 mb-1">
                            <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium w-16 text-center', TIER_COLORS[tier])}>{tier}</span>
                            <span className="text-[11px] text-text-tertiary">{t('routingTierChain', { tier })}</span>
                        </div>
                        <input
                            type="text"
                            value={draft.tiers[tier].join(', ')}
                            onChange={(e) => updateTier(tier, e.target.value)}
                            className="w-full bg-bg-container border border-border rounded-md px-2 py-1.5 text-xs text-text font-mono outline-none focus:border-primary-mint"
                        />
                    </label>
                ))}
            </div>

            {/* Numeric tunables */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {numField(t('simpleMax'), 'boundaries.simpleMax', draft.boundaries.simpleMax)}
                {numField(t('standardMax'), 'boundaries.standardMax', draft.boundaries.standardMax)}
                {numField(t('confidenceK'), 'confidence.k', draft.confidence.k, '1')}
                {numField(t('fallbackThreshold'), 'confidence.fallbackThreshold', draft.confidence.fallbackThreshold)}
                {numField(t('ctxThreshold'), 'overrides.largeContextThreshold', draft.overrides.largeContextThreshold, '1000')}
                {numField(t('momentumWindow'), 'momentum.historySize', draft.momentum.historySize, '1')}
            </div>

            {/* Floors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-text-tertiary">{t('toolFloor')}</span>
                    <select
                        value={draft.overrides.toolFloor}
                        onChange={(e) => updateFloor('toolFloor', e.target.value as RoutingTier)}
                        className="bg-bg-container border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-primary-mint"
                    >
                        {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-text-tertiary">{t('largeCtxFloor')}</span>
                    <select
                        value={draft.overrides.largeContextFloor}
                        onChange={(e) => updateFloor('largeContextFloor', e.target.value as RoutingTier)}
                        className="bg-bg-container border border-border rounded-md px-2 py-1.5 text-xs text-text outline-none focus:border-primary-mint"
                    >
                        {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
                    </select>
                </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
                <button
                    type="button"
                    onClick={reset}
                    disabled={resetting || saving}
                    className="px-3 py-1.5 bg-fill border border-border rounded-lg text-xs text-text-secondary hover:bg-fill-secondary disabled:opacity-50"
                >
                    {resetting ? '...' : t('routingReset')}
                </button>
                <button
                    type="button"
                    onClick={submit}
                    disabled={saving || resetting}
                    className="px-3 py-1.5 bg-primary-mint text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                    {saving ? '...' : t('routingSave')}
                </button>
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
    const [preferences, setPreferences] = React.useState<UserPreferences>({})
    const [telegramRuntime, setTelegramRuntime] = React.useState<TelegramRuntimeInfo>({ configured: true, active: false })
    const [prefsLoading, setPrefsLoading] = React.useState(true)
    const [prefsSaving, setPrefsSaving] = React.useState(false)
    const [prefsError, setPrefsError] = React.useState<string | null>(null)
    const [toolApprovals, setToolApprovals] = React.useState<ToolApprovalRule[]>([])
    const [approvalsLoading, setApprovalsLoading] = React.useState(true)
    const [approvalsError, setApprovalsError] = React.useState<string | null>(null)
    const [deletingApprovalId, setDeletingApprovalId] = React.useState<string | null>(null)
    const [secrets, setSecrets] = React.useState<Record<SecretKey, SecretStatus> | null>(null)
    const [secretsLoading, setSecretsLoading] = React.useState(true)
    const [secretsError, setSecretsError] = React.useState<string | null>(null)
    const [savingSecretKey, setSavingSecretKey] = React.useState<SecretKey | null>(null)
    const [modelConfigOpen, setModelConfigOpen] = React.useState(false)
    const [activeTab, setActiveTab] = React.useState<'config' | 'history' | 'bots'>('config')

    const load = async (requestedMonth = month) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetchModels(requestedMonth)
            setData(res)
        } catch (e: unknown) {
            setError((e as Error).message ?? t('loadFailed'))
        } finally {
            setLoading(false)
        }
    }

    const loadPreferences = async () => {
        setPrefsLoading(true)
        setPrefsError(null)
        try {
            const res = await fetchPreferences()
            setPreferences(res.preferences)
            setTelegramRuntime(res.telegram)
        } catch (e: unknown) {
            setPrefsError((e as Error).message ?? t('telegramBotLoadFailed'))
        } finally {
            setPrefsLoading(false)
        }
    }

    const loadToolApprovals = async () => {
        setApprovalsLoading(true)
        setApprovalsError(null)
        try {
            const res = await fetchToolApprovals()
            setToolApprovals(res.rules)
        } catch (e: unknown) {
            setApprovalsError((e as Error).message ?? t('toolApprovalLoadFailed'))
        } finally {
            setApprovalsLoading(false)
        }
    }

    const loadSecrets = async () => {
        setSecretsLoading(true)
        setSecretsError(null)
        try {
            const res = await fetchSecrets()
            setSecrets(res.secrets)
        } catch (e: unknown) {
            setSecretsError((e as Error).message ?? t('credentialsLoadFailed'))
        } finally {
            setSecretsLoading(false)
        }
    }

    const saveSecret = async (key: SecretKey, value: string) => {
        setSavingSecretKey(key)
        setSecretsError(null)
        try {
            const res = await saveSecrets({ [key]: value })
            setSecrets(res.secrets)
            if (MODEL_PROVIDER_SECRET_KEYS.has(key)) {
                void load()
            }
            if (key === 'TELEGRAM_BOT_TOKEN' || key === 'TELEGRAM_CHAT_ID') {
                void loadPreferences()
            }
        } catch (e: unknown) {
            setSecretsError((e as Error).message ?? t('credentialsSaveFailed'))
        } finally {
            setSavingSecretKey(null)
        }
    }

    React.useEffect(() => {
        void load(month)
    }, [month])

    React.useEffect(() => {
        void loadPreferences()
    }, [])

    React.useEffect(() => {
        void loadToolApprovals()
    }, [])

    React.useEffect(() => {
        void loadSecrets()
    }, [])

    const toggleTelegramBot = async () => {
        const previous = preferences
        const next: UserPreferences = {
            ...preferences,
            telegramBotEnabled: !Boolean(preferences.telegramBotEnabled),
        }

        setPreferences(next)
        setPrefsSaving(true)
        setPrefsError(null)
        try {
            const res = await savePreferences(next)
            setPreferences(res.preferences)
            setTelegramRuntime(res.telegram)
        } catch (e: unknown) {
            setPreferences(previous)
            setPrefsError((e as Error).message ?? t('telegramBotToggleFailed'))
        } finally {
            setPrefsSaving(false)
        }
    }

    const revokeApproval = async (ruleId: string) => {
        setDeletingApprovalId(ruleId)
        setApprovalsError(null)
        try {
            await deleteToolApproval(ruleId)
            setToolApprovals((current) => current.filter((rule) => rule.id !== ruleId))
        } catch (e: unknown) {
            setApprovalsError((e as Error).message ?? t('toolApprovalDeleteFailed'))
        } finally {
            setDeletingApprovalId(null)
        }
    }

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
                    <button onClick={() => { void load() }} className="px-4 py-2 bg-primary-mint text-white rounded-lg text-xs font-medium hover:opacity-90">
                        {t('retry')}
                    </button>
                </div>
            </div>
        )
    }

    if (!data) return null

    const configuredModels = data.models.filter((model) => model.configured)

    type TabKey = 'config' | 'history' | 'bots'
    const tabs: Array<{ key: TabKey; label: string }> = [
        { key: 'config',  label: t('tabModelConfig') },
        { key: 'history', label: t('tabUsageHistory') },
        { key: 'bots',    label: t('tabBots') },
    ]

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
                            onClick={() => {
                                void load()
                                void loadPreferences()
                                void loadToolApprovals()
                                void loadSecrets()
                            }}
                            disabled={loading}
                            className="px-3 py-1.5 bg-fill border border-border rounded-lg text-xs text-text-secondary hover:bg-fill-secondary transition-colors disabled:opacity-50"
                        >
                            {loading ? '...' : t('refresh')}
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-border flex gap-1">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                                'px-4 py-2 text-xs font-medium -mb-px border-b-2 transition-colors',
                                activeTab === tab.key
                                    ? 'border-primary-mint text-text'
                                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Model Config tab */}
                {activeTab === 'config' && (
                    <>
                        <section>
                            <ProviderStatusCard
                                statuses={data.providerStatus ?? []}
                                loading={loading}
                                onRefresh={() => { void load() }}
                                t={t}
                            />
                        </section>

                        <section>
                            <div className="flex items-start justify-between gap-4 mb-2.5">
                                <div>
                                    <h2 className="text-sm font-semibold text-text">{t('availableModels')}</h2>
                                    <p className="text-xs text-text-tertiary mt-1">{t('configuredModelsDescription')}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSecretsError(null)
                                        setModelConfigOpen(true)
                                    }}
                                    className="px-3 py-1.5 bg-primary-mint text-white rounded-lg text-xs font-medium hover:opacity-90 shrink-0"
                                >
                                    {t('addModel')}
                                </button>
                            </div>

                            {configuredModels.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {configuredModels.map((model) => (
                                        <ModelCard key={model.alias} model={model} usage={data.usage.byModel[model.modelId]} t={t} />
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-bg-container border border-border rounded-xl p-6 text-center" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                    <p className="text-sm font-medium text-text">{t('noConfiguredModels')}</p>
                                    <p className="text-xs text-text-tertiary mt-1.5 max-w-lg mx-auto leading-relaxed">{t('noConfiguredModelsDescription')}</p>
                                </div>
                            )}
                        </section>

                        <section>
                            <RoutingEditor
                                routing={data.routing}
                                onSaved={(next) => setData((current) => current ? { ...current, routing: next } : current)}
                                t={t}
                            />
                        </section>
                    </>
                )}

                {/* Usage History tab */}
                {activeTab === 'history' && (
                    <>
                        <section>
                            <h2 className="text-sm font-semibold text-text mb-2.5">{t('usageOverview')} — {data.usage.month}</h2>
                            <UsageSummary data={data} t={t} />
                        </section>

                        <section>
                            <h2 className="text-sm font-semibold text-text mb-2.5">{t('recentHistory')}</h2>
                            <HistoryTable records={data.history} t={t} onViewDetail={setDetailRecord} />
                        </section>
                    </>
                )}

                {/* Bots tab */}
                {activeTab === 'bots' && (
                    <>
                        <section>
                            <h2 className="text-sm font-semibold text-text mb-2.5">{t('telegramBot')}</h2>
                            <TelegramControlCard
                                preferences={preferences}
                                runtime={telegramRuntime}
                                loading={prefsLoading}
                                saving={prefsSaving}
                                error={prefsError}
                                t={t}
                                onToggle={toggleTelegramBot}
                            />
                        </section>

                        <section>
                            <CredentialsCard
                                title={t('telegramCredentials')}
                                description={t('telegramCredentialsDescription')}
                                fields={TELEGRAM_SECRET_FIELDS}
                                statuses={secrets}
                                loading={secretsLoading}
                                savingKey={savingSecretKey}
                                error={secretsError}
                                t={t}
                                onSave={(key, value) => { void saveSecret(key, value) }}
                            />
                        </section>

                        <section>
                            <ToolApprovalsCard
                                rules={toolApprovals}
                                loading={approvalsLoading}
                                deletingId={deletingApprovalId}
                                error={approvalsError}
                                t={t}
                                onRevoke={revokeApproval}
                            />
                        </section>
                    </>
                )}
            </div>

            {/* Detail Modal */}
            {detailRecord && (
                <DetailModal record={detailRecord} t={t} onClose={() => setDetailRecord(null)} />
            )}

            <AddModelModal
                open={modelConfigOpen}
                statuses={secrets}
                loading={secretsLoading}
                savingKey={savingSecretKey}
                error={secretsError}
                t={t}
                onClose={() => setModelConfigOpen(false)}
                onSave={(key, value) => { void saveSecret(key, value) }}
            />
        </div>
    )
}
