import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Cpu, Zap, LayoutGrid, ExternalLink, Upload, Trash2, Plus, X, Loader2, Server, Clock } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import {
    fetchUserApps,
    uploadAppFiles,
    deleteUserApp,
    mcpList,
    mcpSave,
    mcpDelete,
    cronList,
    cronSave,
    cronDelete,
    fetchMe,
    type UserAppInfo,
    type McpServerConfig,
} from '../api'
import type { CronJobInfo } from '../types'
import { ModelPanel } from './ModelPanel'
import { SkillsPanel } from './SkillsPanel'
import { toast } from './Toast'
import { confirm as confirmDialog } from './ConfirmDialog'

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

const McpTab: React.FC = () => {
    const t = useT()
    const [servers, setServers] = React.useState<Record<string, McpServerConfig>>({})
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [editingName, setEditingName] = React.useState('')
    const [command, setCommand] = React.useState('')
    const [args, setArgs] = React.useState('')
    const [cwd, setCwd] = React.useState('')
    const [env, setEnv] = React.useState('')

    const reload = () => {
        setLoading(true)
        mcpList()
            .then((res) => setServers(res.servers))
            .catch(() => {
                setServers({})
                toast.error(t('mcpLoadFailed'))
            })
            .finally(() => setLoading(false))
    }

    React.useEffect(() => { reload() }, [])

    const edit = (name: string, server: McpServerConfig) => {
        setEditingName(name)
        setCommand(server.command)
        setArgs((server.args ?? []).join(' '))
        setCwd(server.cwd ?? '')
        setEnv(Object.entries(server.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'))
    }

    const resetForm = () => {
        setEditingName('')
        setCommand('')
        setArgs('')
        setCwd('')
        setEnv('')
    }

    const save = async () => {
        const name = editingName.trim()
        if (!name || !command.trim()) return
        setSaving(true)
        try {
            await mcpSave(name, {
                command: command.trim(),
                args: parseSpaceDelimitedArgs(args),
                ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
                env: parseEnv(env),
            })
            toast.success(t('mcpSaved'))
            resetForm()
            reload()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('mcpSaveFailed'))
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

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-border shrink-0">
                <h1 className="text-base font-semibold text-text">{t('mcpServers')}</h1>
                <p className="text-xs text-text-tertiary mt-0.5">{t('mcpServersSubtitle')}</p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
                <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text">{editingName && servers[editingName] ? t('editMcpServer') : t('newMcpServer')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder={t('mcpNamePlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50" />
                        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('mcpCommandPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50" />
                        <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t('mcpArgsPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={t('mcpCwdPlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                        <textarea value={env} onChange={(e) => setEnv(e.target.value)} placeholder={t('mcpEnvPlaceholder')} rows={3} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2 font-mono" />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={resetForm} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-fill transition-colors">{t('cancel')}</button>
                        <button disabled={!editingName.trim() || !command.trim() || saving} onClick={() => void save()} className="px-3 py-1.5 rounded-lg bg-primary-mint text-white text-xs font-medium hover:opacity-90 disabled:opacity-50">{saving ? '...' : t('save')}</button>
                    </div>
                </div>
                {loading ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('loading')}</div>
                ) : Object.keys(servers).length === 0 ? (
                    <div className="py-12 text-center text-sm text-text-quaternary">{t('mcpEmpty')}</div>
                ) : (
                    <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                        {Object.entries(servers).map(([name, server]) => (
                            <div key={name} className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
                                <Server size={15} className="text-text-tertiary" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-text truncate">{name}</p>
                                    <p className="text-xs text-text-tertiary truncate font-mono">{server.command} {(server.args ?? []).join(' ')}</p>
                                </div>
                                <button onClick={() => edit(name, server)} className="px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-fill">{t('edit')}</button>
                                <button onClick={() => void remove(name)} className="p-1.5 rounded-lg text-text-tertiary hover:text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Automations Tab ──────────────────────────────────────────────────────────

const AutomationsTab: React.FC = () => {
    const t = useT()
    const [jobs, setJobs] = React.useState<CronJobInfo[]>([])
    const [userId, setUserId] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [name, setName] = React.useState('')
    const [schedule, setSchedule] = React.useState('0 8 * * *')
    const [message, setMessage] = React.useState('')
    const [enabled, setEnabled] = React.useState(true)
    const [timezone, setTimezone] = React.useState('Asia/Shanghai')

    const reload = () => {
        setLoading(true)
        Promise.allSettled([cronList(), fetchMe()])
            .then(([jobsResult, meResult]) => {
                if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value)
                else {
                    setJobs([])
                    toast.error(t('automationsLoadFailed'))
                }
                if (meResult.status === 'fulfilled') setUserId(meResult.value.userId)
                else toast.error(t('automationsLoadFailed'))
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

    const save = async () => {
        if (!name.trim() || !schedule.trim() || !message.trim()) return
        setSaving(true)
        try {
            await cronSave(name.trim(), { cron: schedule.trim(), message, enabled, timezone: timezone.trim() || undefined })
            toast.success(t('cronSaved'))
            setName('')
            setMessage('')
            reload()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t('cronSaveFailed'))
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

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-border shrink-0">
                <h1 className="text-base font-semibold text-text">{t('automations')}</h1>
                <p className="text-xs text-text-tertiary mt-0.5">{t('automationsSubtitle')}</p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
                <div className="bg-bg-container border border-border rounded-xl p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text mb-2">{t('webhook')}</h3>
                    <p className="text-xs text-text-tertiary mb-2">{t('webhookDescription')}</p>
                    <code className="block text-xs font-mono bg-fill-secondary border border-border rounded-lg p-2 overflow-x-auto">
                        {userId ? `/api/webhook/${userId}` : t('loading')}
                    </code>
                </div>
                <div className="bg-bg-container border border-border rounded-xl p-4 space-y-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <h3 className="text-sm font-semibold text-text">{t('cronJobs')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cronNamePlaceholder')} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50" />
                        <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 8 * * *" className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 font-mono" />
                        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Shanghai" className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
                        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('cronMessagePlaceholder')} rows={3} className="bg-fill-secondary border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary-mint/50 md:col-span-2" />
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

type TabId = 'models' | 'skills' | 'apps' | 'mcp' | 'automations'

interface TabDef {
    id: TabId
    labelKey: 'models' | 'skills' | 'apps' | 'mcpServers' | 'automations'
    icon: React.ReactNode
}

const TABS: TabDef[] = [
    { id: 'models', labelKey: 'models', icon: <Cpu size={14} /> },
    { id: 'skills', labelKey: 'skills', icon: <Zap size={14} /> },
    { id: 'apps',   labelKey: 'apps',   icon: <LayoutGrid size={14} /> },
    { id: 'mcp', labelKey: 'mcpServers', icon: <Server size={14} /> },
    { id: 'automations', labelKey: 'automations', icon: <Clock size={14} /> },
]

// ── Main Panel ────────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
    const t = useT()
    const navigate = useNavigate()
    const params = useParams<{ tab?: string }>()

    const activeTab: TabId = TABS.some(tab => tab.id === params.tab) ? params.tab as TabId : 'models'

    const switchTab = (id: TabId) => {
        navigate(`/settings/${id}`)
    }

    return (
        <div className="flex flex-col h-full">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border shrink-0">
                {TABS.map((tab) => (
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

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'models' && <ModelPanel />}
                {activeTab === 'skills' && <SkillsPanel />}
                {activeTab === 'apps'   && <AppsTab />}
                {activeTab === 'mcp' && <McpTab />}
                {activeTab === 'automations' && <AutomationsTab />}
            </div>
        </div>
    )
}
