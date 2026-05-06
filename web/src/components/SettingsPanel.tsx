import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Cpu, Zap, LayoutGrid, ExternalLink } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../i18n'
import { fetchUserApps, type UserAppInfo } from '../api'
import { ModelPanel } from './ModelPanel'
import { SkillsPanel } from './SkillsPanel'

// ── Apps Tab ─────────────────────────────────────────────────────────────────

const AppsTab: React.FC = () => {
    const t = useT()
    const [apps, setApps] = React.useState<UserAppInfo[]>([])
    const [loading, setLoading] = React.useState(true)

    React.useEffect(() => {
        fetchUserApps()
            .then(setApps)
            .catch(() => setApps([]))
            .finally(() => setLoading(false))
    }, [])

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div>
                    <h1 className="text-base font-semibold text-text">{t('apps')}</h1>
                    <p className="text-xs text-text-tertiary mt-0.5">{t('appsSubtitle')}</p>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-text-quaternary text-sm">{t('loading')}</div>
                ) : apps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-fill flex items-center justify-center mb-4">
                            <LayoutGrid size={22} className="text-text-quaternary" />
                        </div>
                        <p className="text-sm font-medium text-text-secondary mb-1">{t('noUserApps')}</p>
                    </div>
                ) : (
                    <div className="bg-bg-container border border-border rounded-xl overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                        {apps.map((app, i) => (
                            <a
                                key={app.name}
                                href={`/apps/${encodeURIComponent(app.name)}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                    'flex items-center gap-3 px-4 py-3 hover:bg-fill/60 transition-colors',
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
                                <ExternalLink size={13} className="text-text-quaternary shrink-0" />
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'models' | 'skills' | 'apps'

interface TabDef {
    id: TabId
    labelKey: 'models' | 'skills' | 'apps'
    icon: React.ReactNode
}

const TABS: TabDef[] = [
    { id: 'models', labelKey: 'models', icon: <Cpu size={14} /> },
    { id: 'skills', labelKey: 'skills', icon: <Zap size={14} /> },
    { id: 'apps',   labelKey: 'apps',   icon: <LayoutGrid size={14} /> },
]

// ── Main Panel ────────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
    const t = useT()
    const location = useLocation()
    const navigate = useNavigate()

    // Parse active tab from hash: /settings#skills
    const hash = location.hash.replace('#', '') as TabId
    const activeTab: TabId = TABS.some(tab => tab.id === hash) ? hash : 'models'

    const switchTab = (id: TabId) => {
        navigate(`/settings#${id}`, { replace: true })
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
            </div>
        </div>
    )
}
