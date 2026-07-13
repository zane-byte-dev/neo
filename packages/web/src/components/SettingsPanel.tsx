import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Clock, ExternalLink, LayoutGrid, Loader2, Plus, RefreshCw, Settings2, Trash2, Upload, Zap } from 'lucide-react'

import {
    atmHealth,
    atmRunList,
    atmScheduleDelete,
    atmScheduleList,
    atmScheduleRun,
    atmScheduleSave,
    deleteUserApp,
    fetchMe,
    fetchPreferences,
    fetchUserApps,
    uploadAppFiles,
    type UserAppInfo,
} from '../api'
import { useT } from '../i18n'
import { cn } from '../lib/utils'
import type { AtmRun, AtmSchedule } from '../types'
import { confirm as confirmDialog } from './ConfirmDialog'
import { toast } from './Toast'

const errorMessage = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback

const SettingsOverview: React.FC = () => {
    const t = useT()
    const [loading, setLoading] = React.useState(true)
    const [neoReady, setNeoReady] = React.useState(false)
    const [atmReady, setAtmReady] = React.useState(false)
    const [account, setAccount] = React.useState('')

    const reload = React.useCallback(() => {
        setLoading(true)
        Promise.allSettled([fetchMe(), fetchPreferences(), atmHealth()])
            .then(([me, preferences, atm]) => {
                setNeoReady(me.status === 'fulfilled' && preferences.status === 'fulfilled')
                setAccount(me.status === 'fulfilled' ? me.value.displayName ?? me.value.userId ?? '' : '')
                setAtmReady(atm.status === 'fulfilled' && atm.value.ok)
            })
            .finally(() => setLoading(false))
    }, [])

    React.useEffect(() => reload(), [reload])

    const tiles = [
        { title: t('systemStatusBackend'), ready: neoReady, detail: neoReady ? t('systemStatusBackendReady') : t('systemStatusBackendFailed') },
        { title: t('systemStatusAccount'), ready: Boolean(account), detail: account ? t('systemStatusAccountReady', { name: account }) : t('systemStatusAccountFailed') },
        { title: 'ATM scheduler', ready: atmReady, detail: atmReady ? t('atmSchedulerConnected') : t('atmSchedulerUnavailableHint') },
    ]

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-bold text-text">{t('settingsOverview')}</h1>
                        <p className="mt-1 text-xs text-text-tertiary">{t('settingsOverviewSubtitle')}</p>
                    </div>
                    <button onClick={reload} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-fill disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('refresh')}
                    </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    {tiles.map((tile) => (
                        <div key={tile.title} className="rounded-xl border border-border bg-bg-container p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                            <div className="flex items-center gap-2">
                                {tile.ready ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                                <h2 className="text-sm font-semibold text-text">{tile.title}</h2>
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-text-secondary">{tile.detail}</p>
                        </div>
                    ))}
                </div>
                {!atmReady && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                        {t('atmManualSessionsUnaffected')}
                    </div>
                )}
            </div>
        </div>
    )
}

const AppsTab: React.FC = () => {
    const t = useT()
    const [apps, setApps] = React.useState<UserAppInfo[]>([])
    const [loading, setLoading] = React.useState(true)
    const [appName, setAppName] = React.useState('')
    const [files, setFiles] = React.useState<File[]>([])
    const [uploading, setUploading] = React.useState(false)

    const reload = React.useCallback(() => {
        setLoading(true)
        fetchUserApps().then(setApps).catch((error) => toast.error(errorMessage(error, t('loadFailed')))).finally(() => setLoading(false))
    }, [t])
    React.useEffect(() => reload(), [reload])

    const upload = async () => {
        if (!appName.trim() || files.length === 0) return
        setUploading(true)
        try {
            await uploadAppFiles(appName.trim(), files)
            setAppName('')
            setFiles([])
            reload()
        } catch (error) {
            toast.error(errorMessage(error, t('loadFailed')))
        } finally {
            setUploading(false)
        }
    }

    const remove = async (app: UserAppInfo) => {
        if (!await confirmDialog(`${t('delete')} ${app.title}?`, { destructive: true, confirmText: t('delete'), cancelText: t('cancel') })) return
        await deleteUserApp(app.name)
        reload()
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
                <div>
                    <h1 className="text-lg font-bold text-text">{t('apps')}</h1>
                    <p className="mt-1 text-xs text-text-tertiary">{t('appsDescription')}</p>
                </div>
                <div className="rounded-xl border border-border bg-bg-container p-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                        <input value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="app-name" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text" />
                        <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-secondary" />
                        <button onClick={() => void upload()} disabled={uploading || !appName.trim() || files.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-mint px-4 py-2 text-xs font-medium text-white disabled:opacity-50">
                            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}{t('uploadApp')}
                        </button>
                    </div>
                </div>
                {loading ? <p className="py-10 text-center text-sm text-text-tertiary">{t('loading')}</p> : (
                    <div className="grid gap-3 md:grid-cols-2">
                        {apps.map((app) => (
                            <div key={app.name} className="flex items-center gap-3 rounded-xl border border-border bg-bg-container p-4">
                                <LayoutGrid size={18} className="text-primary-mint" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-text">{app.title}</p>
                                    <p className="truncate text-xs text-text-tertiary">{app.description ?? app.name}</p>
                                </div>
                                {app.hasIndex && <a href={`/apps/${encodeURIComponent(app.name)}/`} target="_blank" rel="noreferrer" className="p-2 text-text-tertiary hover:text-text"><ExternalLink size={14} /></a>}
                                <button onClick={() => void remove(app)} className="p-2 text-text-tertiary hover:text-destructive"><Trash2 size={14} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

const NEW_SCHEDULE = JSON.stringify({
    schemaVersion: 1,
    id: 'daily-brief',
    name: 'Daily brief',
    enabled: true,
    trigger: { type: 'cron', cron: '0 9 * * 1-5', timezone: 'Asia/Shanghai' },
    task: {
        message: 'Generate today\'s brief.',
        workDir: '/absolute/trusted/workspace',
        skill: 'news-brief',
        tools: ['read', 'grep', 'find', 'ls'],
    },
    policy: { timeoutSeconds: 900, maxRetries: 1, concurrency: 'forbid', missedRun: 'run_once' },
}, null, 2)

const statusTone = (status: AtmRun['status']): string => {
    if (status === 'succeeded') return 'text-emerald-600 dark:text-emerald-400'
    if (status === 'failed' || status === 'timed_out') return 'text-destructive'
    if (status === 'running') return 'text-blue-600 dark:text-blue-400'
    return 'text-text-tertiary'
}

const AutomationsTab: React.FC = () => {
    const t = useT()
    const [schedules, setSchedules] = React.useState<AtmSchedule[]>([])
    const [runs, setRuns] = React.useState<AtmRun[]>([])
    const [editor, setEditor] = React.useState(NEW_SCHEDULE)
    const [editingId, setEditingId] = React.useState('')
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [runningId, setRunningId] = React.useState('')
    const [error, setError] = React.useState('')

    const reload = React.useCallback(() => {
        setLoading(true)
        setError('')
        Promise.all([atmScheduleList(), atmRunList('', 50)])
            .then(([nextSchedules, nextRuns]) => { setSchedules(nextSchedules); setRuns(nextRuns) })
            .catch((reason) => setError(errorMessage(reason, t('automationsLoadFailed'))))
            .finally(() => setLoading(false))
    }, [t])
    React.useEffect(() => reload(), [reload])

    const edit = (schedule?: AtmSchedule) => {
        setEditingId(schedule?.id ?? '')
        setEditor(schedule ? JSON.stringify(schedule, null, 2) : NEW_SCHEDULE)
        setError('')
    }

    const save = async () => {
        let parsed: AtmSchedule
        try {
            parsed = JSON.parse(editor) as AtmSchedule
            if (!parsed || typeof parsed.id !== 'string' || !parsed.id.trim()) throw new Error(t('atmScheduleInvalid'))
            if (editingId && parsed.id !== editingId) throw new Error(t('atmScheduleIdImmutable'))
        } catch (reason) {
            setError(errorMessage(reason, t('atmScheduleInvalid')))
            return
        }
        setSaving(true)
        try {
            await atmScheduleSave(parsed)
            toast.success(t('cronSaved'))
            edit()
            reload()
        } catch (reason) {
            setError(errorMessage(reason, t('cronSaveFailed')))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (schedule: AtmSchedule) => {
        if (!await confirmDialog(t('cronDeleteConfirm').replace('{name}', schedule.name), { destructive: true, confirmText: t('delete'), cancelText: t('cancel') })) return
        try {
            await atmScheduleDelete(schedule.id)
            reload()
        } catch (reason) {
            setError(errorMessage(reason, t('cronDeleteFailed')))
        }
    }

    const runNow = async (schedule: AtmSchedule) => {
        setRunningId(schedule.id)
        try {
            const run = await atmScheduleRun(schedule.id)
            setRuns((current) => [run, ...current.filter((value) => value.id !== run.id)])
            toast.success(t('atmRunQueued'))
        } catch (reason) {
            setError(errorMessage(reason, t('workflowRunFailed')))
        } finally {
            setRunningId('')
        }
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-bold text-text">{t('atmSchedulerTitle')}</h1>
                        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{t('atmSchedulerSubtitle')}</p>
                    </div>
                    <button onClick={reload} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-fill disabled:opacity-50">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('refresh')}
                    </button>
                </div>
                {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">{error}<div className="mt-1 text-text-tertiary">{t('atmManualSessionsUnaffected')}</div></div>}
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-text">{t('cronJobs')}</h2>
                            <button onClick={() => edit()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-fill"><Plus size={12} />{t('atmNewSchedule')}</button>
                        </div>
                        {loading ? <p className="py-8 text-center text-sm text-text-tertiary">{t('loading')}</p> : schedules.length === 0 ? <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-text-tertiary">{t('cronEmpty')}</p> : schedules.map((schedule) => (
                            <div key={schedule.id} className="rounded-xl border border-border bg-bg-container p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                                <div className="flex items-start gap-3">
                                    <Clock size={16} className="mt-0.5 text-primary-mint" />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-semibold text-text">{schedule.name}</h3>
                                            <span className={cn('rounded-full px-2 py-0.5 text-[10px]', schedule.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-fill text-text-tertiary')}>{schedule.enabled ? t('enabled') : t('disabled')}</span>
                                        </div>
                                        <p className="mt-1 font-mono text-[11px] text-text-tertiary">{schedule.id} · {schedule.trigger.type}{schedule.trigger.cron ? ` · ${schedule.trigger.cron}` : ''}</p>
                                        <p className="mt-2 line-clamp-2 text-xs text-text-secondary">{schedule.task.message}</p>
                                    </div>
                                </div>
                                <div className="mt-3 flex justify-end gap-2">
                                    <button onClick={() => void runNow(schedule)} disabled={runningId === schedule.id || !schedule.enabled} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-fill disabled:opacity-50">{runningId === schedule.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}{t('runNow')}</button>
                                    <button onClick={() => edit(schedule)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-fill">{t('edit')}</button>
                                    <button onClick={() => void remove(schedule)} className="p-1.5 text-text-tertiary hover:text-destructive"><Trash2 size={13} /></button>
                                </div>
                            </div>
                        ))}
                    </section>
                    <section className="space-y-3">
                        <h2 className="text-sm font-semibold text-text">{editingId ? `${t('edit')} ${editingId}` : t('atmScheduleDefinition')}</h2>
                        <textarea value={editor} onChange={(event) => setEditor(event.target.value)} spellCheck={false} className="min-h-[430px] w-full resize-y rounded-xl border border-border bg-bg-container p-4 font-mono text-xs leading-relaxed text-text outline-none focus:border-primary-mint" />
                        <p className="text-[11px] leading-relaxed text-text-tertiary">{t('atmScheduleJsonHint')}</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => edit()} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-fill">{t('cancel')}</button>
                            <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-mint px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">{saving && <Loader2 size={12} className="animate-spin" />}{t('save')}</button>
                        </div>
                    </section>
                </div>
                <section className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-text"><Activity size={15} />{t('atmRecentRuns')}</h2>
                    {runs.length === 0 ? <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-text-tertiary">{t('atmNoRuns')}</p> : (
                        <div className="overflow-x-auto rounded-xl border border-border bg-bg-container">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-border text-text-tertiary"><tr><th className="px-3 py-2">Run</th><th className="px-3 py-2">Schedule</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Attempt</th><th className="px-3 py-2">Time</th></tr></thead>
                                <tbody>{runs.map((run) => <tr key={run.id} className="border-b border-border/60 last:border-0"><td className="max-w-48 truncate px-3 py-2 font-mono text-text-secondary">{run.id}</td><td className="px-3 py-2 text-text-secondary">{run.scheduleId}</td><td className={cn('px-3 py-2 font-medium', statusTone(run.status))}>{run.status}</td><td className="px-3 py-2 text-text-tertiary">{run.attempt}</td><td className="px-3 py-2 text-text-tertiary">{new Date(run.queuedAt).toLocaleString()}</td></tr>)}</tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}

type TabId = 'overview' | 'apps' | 'automations'

const TABS: Array<{ id: TabId; label: 'settingsOverview' | 'apps' | 'automations'; icon: React.ReactNode }> = [
    { id: 'overview', label: 'settingsOverview', icon: <Settings2 size={14} /> },
    { id: 'apps', label: 'apps', icon: <LayoutGrid size={14} /> },
    { id: 'automations', label: 'automations', icon: <Clock size={14} /> },
]

export const SettingsPanel: React.FC = () => {
    const t = useT()
    const navigate = useNavigate()
    const params = useParams<{ tab?: string }>()
    const activeTab: TabId = TABS.some((tab) => tab.id === params.tab) ? params.tab as TabId : 'overview'

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-end gap-1 border-b border-border px-4 pt-3">
                {TABS.map((tab) => (
                    <button key={tab.id} onClick={() => navigate(`/settings/${tab.id}`)} className={cn('flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[13px] transition-colors -mb-px', activeTab === tab.id ? 'border-primary-mint font-medium text-text' : 'border-transparent text-text-secondary hover:bg-fill/50 hover:text-text')}>
                        <span className={activeTab === tab.id ? 'text-primary-mint' : 'text-text-tertiary'}>{tab.icon}</span>{t(tab.label)}
                    </button>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab === 'overview' && <SettingsOverview />}
                {activeTab === 'apps' && <AppsTab />}
                {activeTab === 'automations' && <AutomationsTab />}
            </div>
        </div>
    )
}
