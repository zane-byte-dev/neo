import React from 'react'
import {
    Timer, Play, RefreshCw, ChevronDown, ChevronRight,
    CheckCircle2, XCircle, Loader2, Pause, Clock
} from 'lucide-react'
import { cn } from '../lib/utils'
import { cronList, cronToggle, cronRuns, cronTrigger } from '../api'
import type { CronJobInfo, CronRunInfo } from '../types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTs(ms: number | null): string {
    if (!ms) return '—'
    const d = new Date(ms)
    const now = new Date()
    const today = now.toDateString()
    const target = d.toDateString()
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    if (target === today) return `今天 ${time}`
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (target === yesterday.toDateString()) return `昨天 ${time}`
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

function formatDuration(ms: number | null): string {
    if (ms === null) return '—'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

const STATUS_ICON: Record<string, React.ReactNode> = {
    success: <CheckCircle2 size={14} className="text-success" />,
    error:   <XCircle size={14} className="text-destructive" />,
    running: <Loader2 size={14} className="text-info animate-spin" />,
}

// ── Toggle switch ──────────────────────────────────────────────────────────

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
    <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
            checked ? 'bg-primary-mint/60 border-primary-mint/80' : 'bg-fill-tertiary border-border',
            disabled && 'opacity-50 cursor-not-allowed'
        )}
    >
        <span className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5'
        )} />
    </button>
)

// ── Run history row ────────────────────────────────────────────────────────

const RunRow: React.FC<{ run: CronRunInfo }> = ({ run }) => (
    <div className={cn(
        'flex items-center gap-3 px-4 py-2 text-xs border-b border-border/50 last:border-0',
        run.status === 'error' && 'bg-destructive/5'
    )}>
        <span className="shrink-0">{STATUS_ICON[run.status] ?? null}</span>
        <span className="text-text-secondary w-28 shrink-0">{formatTs(run.started_at)}</span>
        <span className="text-text-tertiary w-16 shrink-0 text-right">{formatDuration(run.duration_ms)}</span>
        <span className="flex-1 truncate text-text-tertiary">
            {run.error ? `❌ ${run.error}` : run.summary ? run.summary.slice(0, 120) : ''}
        </span>
    </div>
)

// ── Job card ───────────────────────────────────────────────────────────────

const JobCard: React.FC<{
    job: CronJobInfo
    onToggle: (name: string, enabled: boolean) => Promise<void>
    onTrigger: (name: string) => Promise<void>
}> = ({ job, onToggle, onTrigger }) => {
    const [expanded, setExpanded] = React.useState(false)
    const [runs, setRuns] = React.useState<CronRunInfo[]>([])
    const [loadingRuns, setLoadingRuns] = React.useState(false)
    const [triggering, setTriggering] = React.useState(false)
    const [toggling, setToggling] = React.useState(false)

    const handleExpand = async () => {
        const next = !expanded
        setExpanded(next)
        if (next && runs.length === 0) {
            setLoadingRuns(true)
            try {
                const data = await cronRuns(job.name)
                setRuns(data)
            } finally {
                setLoadingRuns(false)
            }
        }
    }

    const handleTrigger = async () => {
        setTriggering(true)
        try {
            await onTrigger(job.name)
            // Refresh runs
            const data = await cronRuns(job.name)
            setRuns(data)
        } finally {
            setTriggering(false)
        }
    }

    const handleToggle = async (enabled: boolean) => {
        setToggling(true)
        try {
            await onToggle(job.name, enabled)
        } finally {
            setToggling(false)
        }
    }

    const enabled = job.enabled === 1

    return (
        <div className="border border-border rounded-xl bg-bg-container overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={handleExpand} className="shrink-0 text-text-tertiary hover:text-text transition-colors">
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={cn('text-sm font-medium', enabled ? 'text-text' : 'text-text-tertiary line-through')}>
                            {job.name}
                        </span>
                        {job.last_status && (
                            <span className="shrink-0">{STATUS_ICON[job.last_status]}</span>
                        )}
                    </div>
                    {job.description && (
                        <p className="text-xs text-text-tertiary mt-0.5">{job.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-text-quaternary">
                        <span className="flex items-center gap-1">
                            <Clock size={10} />
                            <code className="bg-fill px-1 py-0.5 rounded text-[10px]">{job.schedule}</code>
                        </span>
                        {job.last_started_at && (
                            <span>上次: {formatTs(job.last_started_at)}</span>
                        )}
                        {job.last_duration_ms !== null && (
                            <span>耗时: {formatDuration(job.last_duration_ms)}</span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleTrigger}
                        disabled={triggering}
                        title="手动执行"
                        className="p-1.5 rounded-lg text-text-secondary hover:bg-fill-secondary hover:text-primary-mint transition-colors disabled:opacity-40"
                    >
                        {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                    <Toggle checked={enabled} onChange={handleToggle} disabled={toggling} />
                </div>
            </div>

            {/* Last error */}
            {job.last_status === 'error' && job.last_error && !expanded && (
                <div className="px-4 pb-2 -mt-1">
                    <p className="text-xs text-destructive truncate">❌ {job.last_error}</p>
                </div>
            )}

            {/* Expanded: run history */}
            {expanded && (
                <div className="border-t border-border">
                    <div className="px-4 py-2 bg-fill/50 flex items-center justify-between">
                        <span className="text-xs font-medium text-text-secondary">执行记录</span>
                        <button
                            onClick={async () => { setLoadingRuns(true); try { setRuns(await cronRuns(job.name)); } finally { setLoadingRuns(false); } }}
                            className="text-text-tertiary hover:text-text transition-colors"
                            title="刷新"
                        >
                            <RefreshCw size={12} className={loadingRuns ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    {loadingRuns && runs.length === 0 ? (
                        <div className="flex justify-center py-6">
                            <Loader2 size={16} className="animate-spin text-text-tertiary" />
                        </div>
                    ) : runs.length === 0 ? (
                        <p className="text-xs text-text-quaternary text-center py-4">暂无执行记录</p>
                    ) : (
                        <div className="max-h-60 overflow-y-auto">
                            {runs.map((r) => <RunRow key={r.id} run={r} />)}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Main panel ─────────────────────────────────────────────────────────────

export const CronPanel: React.FC = () => {
    const [jobs, setJobs] = React.useState<CronJobInfo[]>([])
    const [loading, setLoading] = React.useState(true)

    const load = React.useCallback(async () => {
        setLoading(true)
        try {
            setJobs(await cronList())
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => { load() }, [load])

    const handleToggle = async (name: string, enabled: boolean) => {
        await cronToggle(name, enabled)
        setJobs((prev) => prev.map((j) => j.name === name ? { ...j, enabled: enabled ? 1 : 0 } : j))
    }

    const handleTrigger = async (name: string) => {
        await cronTrigger(name)
        // Refresh to get updated last_* fields
        const updated = await cronList()
        setJobs(updated)
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-container shrink-0">
                <div className="flex items-center gap-2">
                    <Timer size={18} className="text-primary-mint" />
                    <h1 className="text-base font-bold text-text">定时任务</h1>
                    <span className="text-xs text-text-quaternary">{jobs.length} 个任务</span>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text bg-fill hover:bg-fill-secondary border border-border rounded-lg transition-colors disabled:opacity-40"
                >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                    刷新
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {loading && jobs.length === 0 ? (
                    <div className="flex justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-text-tertiary" />
                    </div>
                ) : jobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-text-quaternary">
                        <Pause size={32} className="mb-3" />
                        <p className="text-sm">暂无定时任务</p>
                        <p className="text-xs mt-1">在 src/crons/ 目录下添加 CronJob 模块即可自动注册</p>
                    </div>
                ) : (
                    <div className="space-y-3 max-w-3xl mx-auto">
                        {jobs.map((job) => (
                            <JobCard
                                key={job.name}
                                job={job}
                                onToggle={handleToggle}
                                onTrigger={handleTrigger}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
