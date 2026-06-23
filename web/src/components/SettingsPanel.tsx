import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Zap, LayoutGrid, ExternalLink, Upload, Trash2, Plus, X, Loader2, Server, Clock, Activity, AlertTriangle, CheckCircle2, RefreshCw, UserRound, Bot, Plug, ToggleLeft, ToggleRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import {
    fetchUserApps,
    uploadAppFiles,
    deleteUserApp,
    mcpList,
    mcpSave,
    mcpDelete,
    mcpTemplates,
    mcpTestDraft,
    mcpTestServer,
    mcpToggleTool,
    cronList,
    cronSave,
    cronDelete,
    workflowList,
    workflowSave,
    workflowDelete,
    workflowRun,
    fetchMe,
    fetchPreferences,
    type UserAppInfo,
    type McpServerConfig,
    type ConnectorTemplateSummary,
    type McpConnectionResult,
    type MeInfo,
    type PreferencesResponse,
} from '../api'
import type { CronJobInfo, WorkflowDefinition } from '../types'
import { SkillsPanel } from './SkillsPanel'
import { toast } from './Toast'
import { confirm as confirmDialog } from './ConfirmDialog'
import { ActionableErrorBanner } from './ActionableErrorBanner'
import type { TranslationKeys } from '../i18n/locales/en'
import { validateWorkflowId, validateWorkflowJson, type WorkflowValidationIssue } from '../lib/workflow-validation'

const errorMessage = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback

type TranslateFn = (key: TranslationKeys, params?: Record<string, string | number>) => string

type WorkflowFormError = {
    target: 'id' | 'json'
    summary: string
    detail: string
    line?: number
    column?: number
    offset?: number
}

const workflowValidationMessage = (t: TranslateFn, error: WorkflowValidationIssue): string => {
    switch (error.code) {
        case 'invalidJson':
            return t('workflowValidationInvalidJson')
        case 'invalidWorkflowId':
            return t('workflowValidationInvalidId')
        case 'workflowBodyObject':
            return t('workflowValidationBodyObject')
        case 'workflowEnabledBoolean':
            return t('workflowValidationEnabledBoolean')
        case 'workflowTriggerObject':
            return t('workflowValidationTriggerObject')
        case 'workflowTriggerType':
            return t('workflowValidationTriggerType')
        case 'workflowTriggerCron':
            return t('workflowValidationTriggerCron')
        case 'workflowTriggerSecret':
            return t('workflowValidationTriggerSecret')
        case 'workflowStepsArray':
            return t('workflowValidationStepsArray')
        case 'workflowStepsMin':
            return t('workflowValidationStepsMin')
        case 'workflowStepsMax':
            return t('workflowValidationStepsMax', { max: error.meta?.max ?? 20 })
        case 'workflowStepObject':
            return t('workflowValidationStepObject', { step: error.meta?.step ?? '?' })
        case 'workflowStepIdPattern':
            return t('workflowValidationStepId', { step: error.meta?.step ?? '?' })
        case 'workflowStepNameString':
            return t('workflowValidationStepName', { stepId: error.meta?.stepId ?? '?' })
        case 'workflowStepType':
            return t('workflowValidationStepType', { step: error.meta?.step ?? '?' })
        case 'workflowStepTemplate':
            return t('workflowValidationStepTemplate', { stepId: error.meta?.stepId ?? '?' })
        case 'workflowStepMessage':
            return t('workflowValidationStepMessage', { stepId: error.meta?.stepId ?? '?' })
        case 'workflowStepSkillName':
            return t('workflowValidationStepSkillName', { stepId: error.meta?.stepId ?? '?' })
        case 'workflowStepArgsObject':
            return t('workflowValidationStepArgs', { stepId: error.meta?.stepId ?? '?' })
        default:
            return t('workflowSaveFailed')
    }
}

const workflowFormErrorFromIssue = (
    t: TranslateFn,
    target: WorkflowFormError['target'],
    error: WorkflowValidationIssue,
): WorkflowFormError => {
    const summary = workflowValidationMessage(t, error)
    const detailLines = [summary]

    if (error.path) {
        detailLines.push(t('workflowJsonPathLabel', { path: error.path }))
    }
    if (error.line && error.column) {
        detailLines.push(t('workflowJsonLocationLabel', { line: error.line, column: error.column }))
    }
    if (error.code === 'invalidJson' && typeof error.meta?.reason === 'string') {
        detailLines.push(t('workflowJsonSyntaxReason', { reason: error.meta.reason }))
    }

    return {
        target,
        summary,
        detail: detailLines.join('\n'),
        ...(typeof error.line === 'number' ? { line: error.line } : {}),
        ...(typeof error.column === 'number' ? { column: error.column } : {}),
        ...(typeof error.offset === 'number' ? { offset: error.offset } : {}),
    }
}

const workflowInlineError = (t: TranslateFn, error: WorkflowFormError): string => {
    if (typeof error.line === 'number' && typeof error.column === 'number') {
        return `${error.summary} · ${t('workflowJsonLocation', { line: error.line, column: error.column })}`
    }
    return error.summary
}

type OverviewState = {
    me: PromiseSettledResult<MeInfo>
    preferences: PromiseSettledResult<PreferencesResponse>
    crons: PromiseSettledResult<CronJobInfo[]>
    loadedAt: number
}

const StatusTile: React.FC<{
    icon: React.ReactNode
    title: string
    status: string
    summary: string
    tone: 'ok' | 'warning' | 'neutral'
    actionLabel?: string
    onAction?: () => void
}> = ({ icon, title, status, summary, tone, actionLabel, onAction }) => {
    const toneClass = tone === 'ok'
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : tone === 'warning'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            : 'bg-fill text-text-secondary'

    return (
        <div className="rounded-xl border border-border bg-bg-container p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-fill text-text-tertiary">
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-text">{title}</h3>
                        <p className="mt-0.5 text-[11px] text-text-tertiary">{status}</p>
                    </div>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', toneClass)}>
                    {status}
                </span>
            </div>
            <p className="min-h-[2.5rem] text-xs leading-relaxed text-text-secondary">{summary}</p>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-fill px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-fill-secondary"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    )
}

const SettingsOverview: React.FC = () => {
    const t = useT()
    const navigate = useNavigate()
    const [state, setState] = React.useState<OverviewState | null>(null)
    const [loading, setLoading] = React.useState(true)

    const load = React.useCallback(() => {
        setLoading(true)
        Promise.allSettled([fetchMe(), fetchPreferences(), cronList()])
            .then(([me, preferences, crons]) => {
                setState({ me, preferences, crons, loadedAt: Date.now() })
            })
            .finally(() => setLoading(false))
    }, [])

    React.useEffect(() => { load() }, [load])

    const backendOk = Boolean(state && [state.me, state.preferences].every((item) => item.status === 'fulfilled'))
    const accountOk = state?.me.status === 'fulfilled' && Boolean(state.me.value.userId)
    const cronCount = state?.crons.status === 'fulfilled' ? state.crons.value.length : 0
    const ready = backendOk && accountOk
    const firstError = state
        ? [state.me, state.preferences, state.crons].find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
        : undefined

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-lg font-bold text-text">{t('settingsOverview')}</h1>
                        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{t('settingsOverviewSubtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-fill px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-fill-secondary disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
                        {t('refresh')}
                    </button>
                </div>

                <section className="rounded-xl border border-border bg-bg-container p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                            )}>
                                {ready ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-text">{ready ? t('systemStatusReady') : t('systemStatusNeedsAttention')}</p>
                                <p className="mt-0.5 text-xs text-text-tertiary">
                                    {state ? t('systemStatusLastChecked', { time: new Date(state.loadedAt).toLocaleTimeString() }) : t('loading')}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {firstError && (
                    <ActionableErrorBanner
                        title={t('systemStatusLoadFailed')}
                        message={t('systemStatusLoadFailedHint')}
                        detail={errorMessage(firstError.reason, t('loadFailed'))}
                        detailsLabel={t('technicalDetails')}
                        actionLabel={t('retry')}
                        onAction={load}
                    />
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <StatusTile
                        icon={<Server size={15} />}
                        title={t('systemStatusBackend')}
                        status={backendOk ? t('systemStatusReadyShort') : t('systemStatusAttentionShort')}
                        summary={backendOk ? t('systemStatusBackendReady') : t('systemStatusBackendFailed')}
                        tone={backendOk ? 'ok' : 'warning'}
                        actionLabel={!backendOk ? t('retry') : undefined}
                        onAction={!backendOk ? load : undefined}
                    />
                    <StatusTile
                        icon={<UserRound size={15} />}
                        title={t('systemStatusAccount')}
                        status={accountOk ? t('systemStatusReadyShort') : t('systemStatusAttentionShort')}
                        summary={state?.me.status === 'fulfilled'
                            ? t('systemStatusAccountReady', { name: state.me.value.displayName ?? state.me.value.userId ?? '-' })
                            : t('systemStatusAccountFailed')}
                        tone={accountOk ? 'ok' : 'warning'}
                        actionLabel={!accountOk ? t('retry') : undefined}
                        onAction={!accountOk ? load : undefined}
                    />
                    <StatusTile
                        icon={<Bot size={15} />}
                        title={t('systemStatusAutomation')}
                        status={state?.preferences.status === 'fulfilled' && state?.crons.status === 'fulfilled' ? t('systemStatusReadyShort') : t('systemStatusAttentionShort')}
                        summary={state?.preferences.status === 'fulfilled' && state?.crons.status === 'fulfilled'
                            ? t('systemStatusAutomationReady', { count: cronCount })
                            : t('systemStatusAutomationFailed')}
                        tone={state?.preferences.status === 'fulfilled' && state?.crons.status === 'fulfilled' ? 'neutral' : 'warning'}
                        actionLabel={t('systemStatusOpenAutomations')}
                        onAction={() => navigate('/settings/automations')}
                    />
                </div>
            </div>
        </div>
    )
}

// ── Apps Tab ─────────────────────────────────────────────────────────────────

const AppsTab: React.FC = () => {
    const t = useT()
    const [apps, setApps] = React.useState<UserAppInfo[]>([])
    const [loading, setLoading] = React.useState(true)
    const [uploading, setUploading] = React.useState(false)
    const [deletingName, setDeletingName] = React.useState<string | null>(null)
    const [showCreateForm, setShowCreateForm] = React.useState(false)
    const [newAppName, setNewAppName] = React.useState('')
    const [pendingFiles, setPendingFiles] = React.useState<File[]>([])
    const fileInputRef = React.useRef<HTMLInputElement>(null)

    const reload = () => {
        setLoading(true)
        fetchUserApps()
            .then(setApps)
            .catch(() => setApps([]))
            .finally(() => setLoading(false))
    }

    React.useEffect(() => { reload() }, [])

    const handleUpload = async () => {
        const name = newAppName.trim()
        if (!name || pendingFiles.length === 0) return
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
            toast.error(t('appNameInvalid'))
            return
        }
        setUploading(true)
        try {
            await uploadAppFiles(name, pendingFiles)
            toast.success(t('appUploaded').replace('{n}', String(pendingFiles.length)).replace('{name}', name))
            setNewAppName('')
            setPendingFiles([])
            setShowCreateForm(false)
            reload()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('appUploadFailed'))
        } finally {
            setUploading(false)
        }
    }

    const handleDelete = async (app: UserAppInfo) => {
        const ok = await confirmDialog(t('deleteAppConfirm').replace('{name}', app.title), {
            confirmText: t('delete'),
            cancelText: t('cancel'),
            destructive: true,
        })
        if (!ok) return
        setDeletingName(app.name)
        try {
            await deleteUserApp(app.name)
            toast.success(t('appDeleted').replace('{name}', app.title))
            setApps((prev) => prev.filter((a) => a.name !== app.name))
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('appDeleteFailed'))
        } finally {
            setDeletingName(null)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div>
                    <h1 className="text-base font-semibold text-text">{t('apps')}</h1>
                    <p className="text-xs text-text-tertiary mt-0.5">{t('appsSubtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowCreateForm((v) => !v)}
                    className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                        showCreateForm
                            ? 'border-border bg-fill text-text-secondary'
                            : 'border-primary-mint/40 bg-primary-mint/10 text-primary-mint hover:bg-primary-mint/20'
                    )}
                >
                    {showCreateForm ? <X size={13} /> : <Plus size={13} />}
                    {showCreateForm ? t('cancel') : t('newApp')}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
                {/* Create form */}
                {showCreateForm && (
                    <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                        <h3 className="text-sm font-semibold text-text">{t('newApp')}</h3>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-text-tertiary">{t('appName')}</label>
                            <input
                                type="text"
                                value={newAppName}
                                onChange={(e) => setNewAppName(e.target.value)}
                                placeholder="my-app"
                                className="bg-fill-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-text outline-none focus:border-primary-mint/50"
                            />
                            <p className="text-[11px] text-text-quaternary">{t('appNameHint')}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-text-tertiary">{t('appFiles')}</label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                            />
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 border border-dashed border-border rounded-lg px-4 py-3 cursor-pointer hover:bg-fill/50 transition-colors"
                            >
                                <Upload size={14} className="text-text-tertiary shrink-0" />
                                <span className="text-xs text-text-tertiary">
                                    {pendingFiles.length > 0
                                        ? pendingFiles.map((f) => f.name).join(', ')
                                        : t('appFilesHint')}
                                </span>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowCreateForm(false); setNewAppName(''); setPendingFiles([]) }}
                                className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={!newAppName.trim() || pendingFiles.length === 0 || uploading}
                                onClick={handleUpload}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-mint text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                            >
                                {uploading && <Loader2 size={12} className="animate-spin" />}
                                {t('uploadApp')}
                            </button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-text-quaternary text-sm">{t('loading')}</div>
                ) : apps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-fill flex items-center justify-center mb-4">
                            <LayoutGrid size={22} className="text-text-quaternary" />
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">{t('noUserApps')}</p>
                        <p className="text-xs text-text-quaternary mt-1">{t('noUserAppsHint')}</p>
                    </div>
                ) : (
                    <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                        {apps.map((app, i) => (
                            <div
                                key={app.name}
                                className={cn(
                                    'group flex items-center gap-3 px-4 py-3',
                                    i < apps.length - 1 && 'border-b border-border/60'
                                )}
                            >
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-fill border border-border">
                                    <LayoutGrid size={15} className="text-text-tertiary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-text truncate">{app.title}</p>
                                    {app.description && (
                                        <p className="text-xs text-text-tertiary truncate mt-0.5">{app.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <a
                                        href={`/apps/${encodeURIComponent(app.name)}/`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill transition-colors"
                                        title={t('openApp')}
                                    >
                                        <ExternalLink size={13} />
                                    </a>
                                    <button
                                        type="button"
                                        disabled={deletingName === app.name}
                                        onClick={() => void handleDelete(app)}
                                        className="p-1.5 rounded-lg text-text-tertiary hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                                        title={t('deleteApp')}
                                    >
                                        {deletingName === app.name
                                            ? <Loader2 size={13} className="animate-spin" />
                                            : <Trash2 size={13} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── MCP Tab ──────────────────────────────────────────────────────────────────

const parseSpaceDelimitedArgs = (value: string) => value.split(/\s+/).map((s) => s.trim()).filter(Boolean)

const parseEnv = (value: string): Record<string, string> => Object.fromEntries(
    value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const idx = line.indexOf('=')
            return idx >= 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1)] : [line, '']
        })
        .filter(([key]) => key)
)

const CONN_CODE_KEY: Record<McpConnectionResult['code'], TranslationKeys> = {
    ok: 'mcpConnOk',
    missing_secret: 'mcpConnMissingSecret',
    cwd_not_found: 'mcpConnCwdNotFound',
    command_not_found: 'mcpConnCommandNotFound',
    process_exited: 'mcpConnProcessExited',
    timeout: 'mcpConnTimeout',
    invalid_rpc: 'mcpConnInvalidRpc',
    no_tools: 'mcpConnNoTools',
    unknown: 'mcpConnUnknown',
}

const ConnectionResultBadge: React.FC<{ result: McpConnectionResult }> = ({ result }) => {
    const t = useT()
    const ok = result.ok
    return (
        <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-xs', ok ? 'bg-primary-mint/10 text-primary-mint' : 'bg-destructive/10 text-destructive')}>
            {ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
                <p className="font-medium">{t(CONN_CODE_KEY[result.code])}{ok && typeof result.toolCount === 'number' ? ` · ${result.toolCount}` : ''}</p>
                <p className="text-text-tertiary break-words">{result.message}</p>
            </div>
        </div>
    )
}

const McpTab: React.FC = () => {
    const t = useT()
    const [servers, setServers] = React.useState<Record<string, McpServerConfig>>({})
    const [disabledTools, setDisabledTools] = React.useState<Record<string, string[]>>({})
    const [templates, setTemplates] = React.useState<ConnectorTemplateSummary[]>([])
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [loadError, setLoadError] = React.useState<string | null>(null)
    const [saveError, setSaveError] = React.useState<string | null>(null)
    const [editingName, setEditingName] = React.useState('')
    const [templateId, setTemplateId] = React.useState('')
    const [templateInputs, setTemplateInputs] = React.useState<Record<string, string>>({})
    const [command, setCommand] = React.useState('')
    const [args, setArgs] = React.useState('')
    const [cwd, setCwd] = React.useState('')
    const [env, setEnv] = React.useState('')
    const [testing, setTesting] = React.useState(false)
    const [draftResult, setDraftResult] = React.useState<McpConnectionResult | null>(null)
    const [serverTests, setServerTests] = React.useState<Record<string, McpConnectionResult>>({})
    const [testingServer, setTestingServer] = React.useState<string | null>(null)
    const nameInputRef = React.useRef<HTMLInputElement>(null)
    const commandInputRef = React.useRef<HTMLInputElement>(null)

    const activeTemplate = templates.find((tpl) => tpl.id === templateId) ?? null

    const reload = () => {
        setLoading(true)
        setLoadError(null)
        mcpList()
            .then((res) => {
                setServers(res.servers)
                setDisabledTools(res.disabledTools ?? {})
            })
            .catch((error: unknown) => {
                setServers({})
                setLoadError(errorMessage(error, t('mcpLoadFailed')))
                toast.error(t('mcpLoadFailed'))
            })
            .finally(() => setLoading(false))
    }

    React.useEffect(() => { reload() }, [])
    React.useEffect(() => {
        mcpTemplates().then((res) => setTemplates(res.templates)).catch(() => setTemplates([]))
    }, [])

    const edit = (name: string, server: McpServerConfig) => {
        setTemplateId('')
        setEditingName(name)
        setCommand(server.command)
        setArgs((server.args ?? []).join(' '))
        setCwd(server.cwd ?? '')
        setEnv(Object.entries(server.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'))
        setDraftResult(null)
    }

    const resetForm = () => {
        setEditingName('')
        setTemplateId('')
        setTemplateInputs({})
        setCommand('')
        setArgs('')
        setCwd('')
        setEnv('')
        setDraftResult(null)
    }

    const pickTemplate = (id: string) => {
        setTemplateId(id)
        setTemplateInputs({})
        setDraftResult(null)
    }

    // Build the request body for /api/mcp/test (and the basis for save).
    const draftBody = (): McpServerConfig | { templateId: string; inputs: Record<string, string> } | null => {
        if (templateId) {
            return { templateId, inputs: templateInputs }
        }
        if (!command.trim()) return null
        return {
            command: command.trim(),
            args: parseSpaceDelimitedArgs(args),
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            env: parseEnv(env),
        }
    }

    const testDraft = async () => {
        const body = draftBody()
        if (!body) return
        setTesting(true)
        setDraftResult(null)
        try {
            setDraftResult(await mcpTestDraft(body))
        } catch (e) {
            toast.error(errorMessage(e, t('mcpConnUnknown')))
        } finally {
            setTesting(false)
        }
    }

    const canSave = (): boolean => {
        if (!editingName.trim()) return false
        if (templateId) {
            return (activeTemplate?.fields ?? []).every((f) => !f.required || (templateInputs[f.key] ?? '').trim())
        }
        return !!command.trim()
    }

    const save = async () => {
        const name = editingName.trim()
        if (!canSave()) return
        setSaving(true)
        setSaveError(null)
        try {
            if (templateId) {
                // Resolve the template server-side (also validates required fields),
                // then persist the expanded config.
                const res = await mcpTestDraft({ templateId, inputs: templateInputs })
                if (!res.config) throw new Error(res.message || t('mcpSaveFailed'))
                await mcpSave(name, res.config)
            } else {
                await mcpSave(name, {
                    command: command.trim(),
                    args: parseSpaceDelimitedArgs(args),
                    ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
                    env: parseEnv(env),
                })
            }
            toast.success(t('mcpSaved'))
            resetForm()
            reload()
        } catch (e) {
            setSaveError(errorMessage(e, t('mcpSaveFailed')))
            toast.error(t('mcpSaveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (name: string) => {
        if (!await confirmDialog(t('mcpDeleteConfirm').replace('{name}', name), { destructive: true, confirmText: t('delete'), cancelText: t('cancel') })) return
        try {
            await mcpDelete(name)
            toast.success(t('mcpDeleted'))
            reload()
        } catch {
            toast.error(t('mcpDeleteFailed'))
        }
    }

    const testServer = async (name: string) => {
        setTestingServer(name)
        try {
            const res = await mcpTestServer(name)
            setServerTests((prev) => ({ ...prev, [name]: res }))
        } catch (e) {
            toast.error(errorMessage(e, t('mcpConnUnknown')))
        } finally {
            setTestingServer(null)
        }
    }

    const toggleTool = async (name: string, tool: string, enabled: boolean) => {
        try {
            await mcpToggleTool(name, tool, enabled)
            setDisabledTools((prev) => {
                const current = new Set(prev[name] ?? [])
                if (enabled) current.delete(tool)
                else current.add(tool)
                const next = { ...prev }
                if (current.size > 0) next[name] = [...current]
                else delete next[name]
                return next
            })
        } catch (e) {
            toast.error(errorMessage(e, t('mcpToggleFailed')))
        }
    }

    const isToolDisabled = (name: string, tool: string) => (disabledTools[name] ?? []).includes(tool)

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-border shrink-0">
                <h1 className="text-base font-semibold text-text">{t('mcpServers')}</h1>
                <p className="text-xs text-text-tertiary mt-0.5">{t('mcpServersSubtitle')}</p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
                {loadError && (
                    <ActionableErrorBanner
                        title={t('mcpLoadFailed')}
                        message={t('mcpLoadRecoveryHint')}
                        detail={loadError}
                        detailsLabel={t('technicalDetails')}
                        actionLabel={t('retry')}
                        onAction={reload}
                    />
                )}
                {saveError && (
                    <ActionableErrorBanner
                        title={t('mcpSaveFailed')}
                        message={t('mcpSaveRecoveryHint')}
                        detail={saveError}
                        detailsLabel={t('technicalDetails')}
                        actionLabel={t('mcpFixRequiredFields')}
                        onAction={() => (editingName.trim() ? commandInputRef : nameInputRef).current?.focus()}
                    />
                )}
                <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text">{editingName && servers[editingName] ? t('editMcpServer') : t('newMcpServer')}</h3>
                    {/* Template picker (only when creating a new server). */}
                    {!(editingName && servers[editingName]) && templates.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Plug size={13} className="text-text-tertiary" />
                            <button
                                onClick={() => pickTemplate('')}
                                className={cn('px-2.5 py-1 rounded-lg border text-xs transition-colors', !templateId ? 'border-primary-mint/50 bg-primary-mint/10 text-primary-mint' : 'border-border text-text-secondary hover:bg-fill')}
                            >{t('mcpManual')}</button>
                            {templates.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    onClick={() => pickTemplate(tpl.id)}
                                    className={cn('px-2.5 py-1 rounded-lg border text-xs transition-colors', templateId === tpl.id ? 'border-primary-mint/50 bg-primary-mint/10 text-primary-mint' : 'border-border text-text-secondary hover:bg-fill')}
                                >{tpl.label}</button>
                            ))}
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input ref={nameInputRef} value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder={t('mcpNamePlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                        {activeTemplate ? (
                            <>
                                {activeTemplate.description && (
                                    <p className="text-xs text-text-tertiary md:col-span-2">{activeTemplate.description}</p>
                                )}
                                {activeTemplate.fields.map((field) => (
                                    <input
                                        key={field.key}
                                        type={field.secret ? 'password' : 'text'}
                                        value={templateInputs[field.key] ?? ''}
                                        onChange={(e) => setTemplateInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                        placeholder={`${field.label}${field.required ? ' *' : ''}${field.placeholder ? ` — ${field.placeholder}` : ''}`}
                                        className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2"
                                    />
                                ))}
                            </>
                        ) : (
                            <>
                                <input ref={commandInputRef} value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('mcpCommandPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                                <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t('mcpArgsPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                                <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={t('mcpCwdPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                                <textarea value={env} onChange={(e) => setEnv(e.target.value)} placeholder={t('mcpEnvPlaceholder')} rows={3} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2 font-mono" />
                            </>
                        )}
                    </div>
                    {draftResult && <ConnectionResultBadge result={draftResult} />}
                    <div className="flex justify-end gap-2">
                        <button onClick={resetForm} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors">{t('cancel')}</button>
                        <button disabled={!draftBody() || testing} onClick={() => void testDraft()} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">{testing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}{testing ? t('mcpTesting') : t('mcpTestConnection')}</button>
                        <button disabled={!canSave() || saving} onClick={() => void save()} className="px-3 py-1.5 rounded-lg bg-primary-mint text-white text-xs font-medium hover:opacity-90 disabled:opacity-50">{saving ? '...' : t('save')}</button>
                    </div>
                </div>
                {loading ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('loading')}</div>
                ) : Object.keys(servers).length === 0 ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('mcpEmpty')}</div>
                ) : (
                    <div className="space-y-3">
                        {Object.entries(servers).map(([name, server]) => {
                            const test = serverTests[name]
                            return (
                                <div key={name} className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                    <div className="flex items-center gap-3 px-4 py-3">
                                        <Server size={15} className="text-text-tertiary" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-semibold text-text truncate">{name}</p>
                                            <p className="text-xs text-text-tertiary truncate font-mono">{server.command} {(server.args ?? []).join(' ')}</p>
                                        </div>
                                        <button disabled={testingServer === name} onClick={() => void testServer(name)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill disabled:opacity-50 inline-flex items-center gap-1">{testingServer === name ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}{t('mcpTestConnection')}</button>
                                        <button onClick={() => edit(name, server)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill">{t('edit')}</button>
                                        <button onClick={() => void remove(name)} className="p-1.5 rounded-lg text-text-tertiary hover:text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button>
                                    </div>
                                    {(test || (disabledTools[name]?.length ?? 0) > 0) && (
                                        <div className="px-4 pb-3 space-y-2 border-t border-border/60 pt-3">
                                            {test && <ConnectionResultBadge result={test} />}
                                            {test?.tools && test.tools.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">{t('mcpToolsTitle')}</p>
                                                    {test.tools.map((tool) => {
                                                        const disabled = isToolDisabled(name, tool.name)
                                                        return (
                                                            <div key={tool.name} className="flex items-center gap-2 text-xs">
                                                                <button onClick={() => void toggleTool(name, tool.name, disabled)} className={cn('inline-flex items-center', disabled ? 'text-text-quaternary' : 'text-primary-mint')} title={disabled ? t('mcpToolDisabled') : t('mcpToolEnabled')}>
                                                                    {disabled ? <ToggleLeft size={18} /> : <ToggleRight size={18} />}
                                                                </button>
                                                                <span className={cn('font-mono', disabled && 'line-through text-text-quaternary')}>{tool.name}</span>
                                                                {tool.description && <span className="text-text-quaternary truncate">— {tool.description}</span>}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {!test && (disabledTools[name]?.length ?? 0) > 0 && (
                                                <p className="text-xs text-text-tertiary">{t('mcpToolDisabled')}: <span className="font-mono">{(disabledTools[name] ?? []).join(', ')}</span></p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Automations Tab ──────────────────────────────────────────────────────────

const DEFAULT_WORKFLOW_JSON = JSON.stringify({
    name: 'Morning brief workflow',
    description: 'Two-step example workflow',
    enabled: true,
    trigger: { type: 'manual' },
    steps: [
        { id: 'collect', type: 'transform', template: 'Input: {{input.message}}' },
        { id: 'summarize', type: 'agent', message: 'Summarize this into three concise bullets:\n{{previous}}' },
    ],
}, null, 2)

const AutomationsTab: React.FC = () => {
    const t = useT()
    const [jobs, setJobs] = React.useState<CronJobInfo[]>([])
    const [workflows, setWorkflows] = React.useState<WorkflowDefinition[]>([])
    const [userId, setUserId] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [workflowSaving, setWorkflowSaving] = React.useState(false)
    const [workflowRunningId, setWorkflowRunningId] = React.useState<string | null>(null)
    const [loadError, setLoadError] = React.useState<string | null>(null)
    const [saveError, setSaveError] = React.useState<string | null>(null)
    const [workflowError, setWorkflowError] = React.useState<WorkflowFormError | null>(null)
    const [name, setName] = React.useState('')
    const [schedule, setSchedule] = React.useState('0 8 * * *')
    const [message, setMessage] = React.useState('')
    const [enabled, setEnabled] = React.useState(true)
    const [timezone, setTimezone] = React.useState('Asia/Shanghai')
    const [workflowId, setWorkflowId] = React.useState('')
    const [workflowJson, setWorkflowJson] = React.useState(DEFAULT_WORKFLOW_JSON)
    const nameInputRef = React.useRef<HTMLInputElement>(null)
    const scheduleInputRef = React.useRef<HTMLInputElement>(null)
    const messageInputRef = React.useRef<HTMLTextAreaElement>(null)
    const workflowIdInputRef = React.useRef<HTMLInputElement>(null)
    const workflowJsonInputRef = React.useRef<HTMLTextAreaElement>(null)

    const focusWorkflowField = (error: WorkflowFormError) => {
        if (error.target === 'id') {
            workflowIdInputRef.current?.focus()
            return
        }

        const input = workflowJsonInputRef.current
        if (!input) return
        input.focus()

        if (typeof error.offset === 'number') {
            const offset = Math.max(0, Math.min(error.offset, input.value.length))
            requestAnimationFrame(() => input.setSelectionRange(offset, offset))
        }
    }

    const reload = () => {
        setLoading(true)
        setLoadError(null)
        Promise.allSettled([cronList(), fetchMe(), workflowList()])
            .then(([jobsResult, meResult, workflowsResult]) => {
                if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value)
                else {
                    setJobs([])
                    setLoadError(errorMessage(jobsResult.reason, t('automationsLoadFailed')))
                    toast.error(t('automationsLoadFailed'))
                }
                if (meResult.status === 'fulfilled') setUserId(meResult.value.userId)
                else {
                    setLoadError(errorMessage(meResult.reason, t('automationsLoadFailed')))
                    toast.error(t('automationsLoadFailed'))
                }
                if (workflowsResult.status === 'fulfilled') setWorkflows(workflowsResult.value.workflows)
                else {
                    setWorkflows([])
                    setLoadError(errorMessage(workflowsResult.reason, t('automationsLoadFailed')))
                    toast.error(t('automationsLoadFailed'))
                }
            })
            .finally(() => setLoading(false))
    }

    React.useEffect(() => { reload() }, [])

    const edit = (job: CronJobInfo) => {
        setName(job.name)
        setSchedule(job.schedule)
        setMessage(job.description ?? '')
        setEnabled(job.enabled !== 0)
    }

    const editWorkflow = (workflow: WorkflowDefinition) => {
        const { lastRun: _lastRun, ...editable } = workflow
        setWorkflowId(workflow.id)
        setWorkflowJson(JSON.stringify(editable, null, 2))
        setWorkflowError(null)
    }

    const resetWorkflowForm = () => {
        setWorkflowId('')
        setWorkflowJson(DEFAULT_WORKFLOW_JSON)
        setWorkflowError(null)
    }

    const save = async () => {
        if (!name.trim() || !schedule.trim() || !message.trim()) return
        setSaving(true)
        setSaveError(null)
        try {
            await cronSave(name.trim(), { cron: schedule.trim(), message, enabled, timezone: timezone.trim() || undefined })
            toast.success(t('cronSaved'))
            setName('')
            setMessage('')
            reload()
        } catch (e) {
            setSaveError(errorMessage(e, t('cronSaveFailed')))
            toast.error(t('cronSaveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (job: CronJobInfo) => {
        if (!await confirmDialog(t('cronDeleteConfirm').replace('{name}', job.name), { destructive: true, confirmText: t('delete'), cancelText: t('cancel') })) return
        try {
            await cronDelete(job.name)
            toast.success(t('cronDeleted'))
            reload()
        } catch {
            toast.error(t('cronDeleteFailed'))
        }
    }

    const saveWorkflowFromJson = async () => {
        const trimmedWorkflowId = workflowId.trim()
        if (!trimmedWorkflowId) {
            workflowIdInputRef.current?.focus()
            return
        }
        setWorkflowError(null)

        const workflowIdIssue = validateWorkflowId(trimmedWorkflowId)
        if (workflowIdIssue) {
            const nextError = workflowFormErrorFromIssue(t, 'id', workflowIdIssue)
            setWorkflowError(nextError)
            focusWorkflowField(nextError)
            return
        }

        const workflowValidation = validateWorkflowJson(workflowJson)
        if (!workflowValidation.ok) {
            const nextError = workflowFormErrorFromIssue(t, 'json', workflowValidation.error)
            setWorkflowError(nextError)
            focusWorkflowField(nextError)
            return
        }

        setWorkflowSaving(true)
        try {
            await workflowSave(trimmedWorkflowId, workflowValidation.value)
            toast.success(t('workflowSaved'))
            resetWorkflowForm()
            reload()
        } catch (e) {
            const detail = errorMessage(e, t('workflowSaveFailed'))
            setWorkflowError({ target: 'json', summary: detail, detail })
            toast.error(t('workflowSaveFailed'))
        } finally {
            setWorkflowSaving(false)
        }
    }

    const removeWorkflow = async (workflow: WorkflowDefinition) => {
        if (!await confirmDialog(t('workflowDeleteConfirm').replace('{name}', workflow.name), { destructive: true, confirmText: t('delete'), cancelText: t('cancel') })) return
        try {
            await workflowDelete(workflow.id)
            toast.success(t('workflowDeleted'))
            reload()
        } catch {
            toast.error(t('workflowDeleteFailed'))
        }
    }

    const runWorkflowNow = async (workflow: WorkflowDefinition) => {
        setWorkflowRunningId(workflow.id)
        try {
            const res = await workflowRun(workflow.id, { message: `Manual run: ${workflow.name}` })
            if (res.run.status === 'success') toast.success(t('workflowRunSuccess'))
            else toast.error(res.run.error ?? t('workflowRunFailed'))
            reload()
        } catch (e) {
            toast.error(errorMessage(e, t('workflowRunFailed')))
        } finally {
            setWorkflowRunningId(null)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-border shrink-0">
                <h1 className="text-base font-semibold text-text">{t('automations')}</h1>
                <p className="text-xs text-text-tertiary mt-0.5">{t('automationsSubtitle')}</p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
                {loadError && (
                    <ActionableErrorBanner
                        title={t('automationsLoadFailed')}
                        message={t('automationsLoadRecoveryHint')}
                        detail={loadError}
                        detailsLabel={t('technicalDetails')}
                        actionLabel={t('retry')}
                        onAction={reload}
                    />
                )}
                {saveError && (
                    <ActionableErrorBanner
                        title={t('cronSaveFailed')}
                        message={t('cronSaveRecoveryHint')}
                        detail={saveError}
                        detailsLabel={t('technicalDetails')}
                        actionLabel={t('cronFixRequiredFields')}
                        onAction={() => {
                            if (!name.trim()) nameInputRef.current?.focus()
                            else if (!schedule.trim()) scheduleInputRef.current?.focus()
                            else messageInputRef.current?.focus()
                        }}
                    />
                )}
                <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text mb-2">{t('webhook')}</h3>
                    <p className="text-xs text-text-tertiary mb-2">{t('webhookDescription')}</p>
                    <code className="block text-xs font-mono bg-fill-secondary border border-border rounded-lg p-2 overflow-x-auto">
                        {userId ? `/api/webhook/${userId}` : t('loading')}
                    </code>
                </div>
                <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-text">{t('workflows')}</h3>
                            <p className="text-xs text-text-tertiary mt-0.5">{t('workflowsDescription')}</p>
                        </div>
                        <button onClick={resetWorkflowForm} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill">{t('newWorkflow')}</button>
                    </div>
                    {workflowError && (
                        <ActionableErrorBanner
                            title={t('workflowSaveFailed')}
                            message={t('workflowSaveRecoveryHint')}
                            detail={workflowError.detail}
                            detailsLabel={t('technicalDetails')}
                            actionLabel={workflowError.target === 'id' ? t('workflowFixId') : t('workflowFixJson')}
                            onAction={() => focusWorkflowField(workflowError)}
                        />
                    )}
                    <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-1.5">
                            <input
                                ref={workflowIdInputRef}
                                value={workflowId}
                                onChange={(e) => {
                                    setWorkflowId(e.target.value)
                                    if (workflowError?.target === 'id') setWorkflowError(null)
                                }}
                                placeholder={t('workflowIdPlaceholder')}
                                aria-invalid={workflowError?.target === 'id'}
                                className={cn(
                                    'bg-fill-secondary border rounded-lg px-3 py-2 text-xs text-text outline-none',
                                    workflowError?.target === 'id' ? 'border-warning focus:border-warning' : 'border-border focus:border-primary-mint/50',
                                )}
                            />
                            <p className={cn('text-[11px]', workflowError?.target === 'id' ? 'text-warning' : 'text-text-tertiary')}>
                                {workflowError?.target === 'id' ? workflowError.summary : t('workflowIdHint')}
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <textarea
                                ref={workflowJsonInputRef}
                                value={workflowJson}
                                onChange={(e) => {
                                    setWorkflowJson(e.target.value)
                                    if (workflowError?.target === 'json') setWorkflowError(null)
                                }}
                                rows={8}
                                aria-invalid={workflowError?.target === 'json'}
                                spellCheck={false}
                                className={cn(
                                    'bg-fill-secondary border rounded-lg px-3 py-2 text-xs text-text outline-none font-mono',
                                    workflowError?.target === 'json' ? 'border-warning focus:border-warning' : 'border-border focus:border-primary-mint/50',
                                )}
                            />
                            <p className={cn('text-[11px]', workflowError?.target === 'json' ? 'text-warning' : 'text-text-tertiary')}>
                                {workflowError?.target === 'json' ? workflowInlineError(t, workflowError) : t('workflowJsonHint')}
                            </p>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={resetWorkflowForm} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors">{t('cancel')}</button>
                        <button disabled={!workflowId.trim() || workflowSaving} onClick={() => void saveWorkflowFromJson()} className="px-3 py-1.5 rounded-lg bg-primary-mint text-white text-xs font-medium hover:opacity-90 disabled:opacity-50">{workflowSaving ? '...' : t('save')}</button>
                    </div>
                    {workflows.length === 0 ? (
                        <div className="py-8 text-center text-sm text-text-quaternary">{t('workflowEmpty')}</div>
                    ) : (
                        <div className="border border-border rounded-xl overflow-hidden">
                            {workflows.map((workflow) => (
                                <div key={workflow.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
                                    <Zap size={15} className="text-text-tertiary" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-semibold text-text truncate">{workflow.name} <span className="text-[11px] text-text-quaternary font-normal">{workflow.enabled ? t('enabled') : t('disabled')}</span></p>
                                        <p className="text-xs text-text-tertiary truncate">{workflow.trigger.type} · {workflow.steps.length} {t('workflowSteps')}</p>
                                        {workflow.lastRun && <p className="text-xs text-text-tertiary truncate">{t('workflowLastRun')}: {workflow.lastRun.status}{workflow.lastRun.summary ? ` · ${workflow.lastRun.summary}` : ''}</p>}
                                    </div>
                                    <button disabled={workflowRunningId === workflow.id} onClick={() => void runWorkflowNow(workflow)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill disabled:opacity-50">{workflowRunningId === workflow.id ? '...' : t('runNow')}</button>
                                    <button onClick={() => editWorkflow(workflow)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill">{t('edit')}</button>
                                    <button onClick={() => void removeWorkflow(workflow)} className="p-1.5 rounded-lg text-text-tertiary hover:text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text">{t('cronJobs')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input ref={nameInputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cronNamePlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50" />
                        <input ref={scheduleInputRef} value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 8 * * *" className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 font-mono" />
                        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Shanghai" className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                        <textarea ref={messageInputRef} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('cronMessagePlaceholder')} rows={3} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                        {t('enabled')}
                    </label>
                    <div className="flex justify-end">
                        <button disabled={!name.trim() || !schedule.trim() || !message.trim() || saving} onClick={() => void save()} className="px-3 py-1.5 rounded-lg bg-primary-mint text-white text-xs font-medium hover:opacity-90 disabled:opacity-50">{saving ? '...' : t('save')}</button>
                    </div>
                </div>
                {loading ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('loading')}</div>
                ) : jobs.length === 0 ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('cronEmpty')}</div>
                ) : (
                    <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                        {jobs.map((job) => (
                            <div key={job.name} className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
                                <Clock size={15} className="text-text-tertiary" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-text truncate">{job.name} <span className="text-[11px] text-text-quaternary font-normal">{job.enabled ? t('enabled') : t('disabled')}</span></p>
                                    <p className="text-xs text-text-tertiary truncate font-mono">{job.schedule}</p>
                                    {job.description && <p className="text-xs text-text-tertiary truncate">{job.description}</p>}
                                </div>
                                <button onClick={() => edit(job)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill">{t('edit')}</button>
                                <button onClick={() => void remove(job)} className="p-1.5 rounded-lg text-text-tertiary hover:text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'overview' | 'skills' | 'apps' | 'mcp' | 'automations'
type TabGroup = 'basic' | 'advanced'

interface TabDef {
    id: TabId
    labelKey: 'settingsOverview' | 'skills' | 'apps' | 'mcpServers' | 'automations'
    group: TabGroup
    icon: React.ReactNode
}

const TABS: TabDef[] = [
    { id: 'overview', labelKey: 'settingsOverview', group: 'basic', icon: <Activity size={14} /> },
    { id: 'skills', labelKey: 'skills', group: 'basic', icon: <Zap size={14} /> },
    { id: 'apps',   labelKey: 'apps', group: 'advanced', icon: <LayoutGrid size={14} /> },
    { id: 'mcp', labelKey: 'mcpServers', group: 'advanced', icon: <Server size={14} /> },
    { id: 'automations', labelKey: 'automations', group: 'advanced', icon: <Clock size={14} /> },
]

const TAB_GROUPS: Array<{ id: TabGroup; labelKey: 'settingsGroupBasic' | 'settingsGroupAdvanced' }> = [
    { id: 'basic', labelKey: 'settingsGroupBasic' },
    { id: 'advanced', labelKey: 'settingsGroupAdvanced' },
]

// ── Main Panel ────────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
    const t = useT()
    const navigate = useNavigate()
    const params = useParams<{ tab?: string }>()

    const activeTab: TabId = TABS.some(tab => tab.id === params.tab) ? params.tab as TabId : 'overview'

    const switchTab = (id: TabId) => {
        navigate(`/settings/${id}`)
    }

    return (
        <div className="flex flex-col h-full">
            {/* Tab bar */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2 px-4 pt-3 pb-0 border-b border-border shrink-0">
                {TAB_GROUPS.map((group) => (
                    <div key={group.id} className="flex items-end gap-1">
                        <span className="mb-2 mr-1 text-[10px] font-semibold uppercase text-text-quaternary">
                            {t(group.labelKey)}
                        </span>
                        {TABS.filter((tab) => tab.group === group.id).map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => switchTab(tab.id)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-t-lg transition-colors border-b-2 -mb-px',
                                    activeTab === tab.id
                                        ? 'border-primary-mint text-text font-medium'
                                        : 'border-transparent text-text-secondary hover:text-text hover:bg-fill/50'
                                )}
                            >
                                <span className={cn(activeTab === tab.id ? 'text-primary-mint' : 'text-text-tertiary')}>
                                    {tab.icon}
                                </span>
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'overview' && <SettingsOverview />}
                {activeTab === 'skills' && <SkillsPanel />}
                {activeTab === 'apps'   && <AppsTab />}
                {activeTab === 'mcp' && <McpTab />}
                {activeTab === 'automations' && <AutomationsTab />}
            </div>
        </div>
    )
}
