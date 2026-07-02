import React from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart2, BookOpen, CheckCircle2, Circle, FolderOpen, MessageSquare, PenLine, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { notebookList, notebookListNotebooks } from '../api'
import { useT } from '../i18n'

const GhostLogo: React.FC = () => (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="56" height="56" rx="16" fill="url(#ghost-bg)" />
        {/* Ghost body */}
        <path
            d="M18 24a10 10 0 0 1 20 0v14l-3-3-3 3-3-3-3 3-3-3-2 3V24z"
            fill="white"
            fillOpacity="0.92"
        />
        {/* Eyes */}
        <circle cx="24" cy="25" r="2.2" fill="#34d399" />
        <circle cx="32" cy="25" r="2.2" fill="#34d399" />
        <defs>
            <linearGradient id="ghost-bg" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                <stop stopColor="#34d399" />
                <stop offset="1" stopColor="#059669" />
            </linearGradient>
        </defs>
    </svg>
)

const FEATURE_CARDS = [
    {
        icon: FolderOpen,
        iconColor: 'text-primary-mint',
        iconBg: 'bg-primary-mint/10 group-hover:bg-primary-mint/20',
        titleKey: 'welcomeCardFilesTitle',
        descKey: 'welcomeCardFilesDesc',
        starterKey: 'welcomeCardFilesStarter',
    },
    {
        icon: PenLine,
        iconColor: 'text-violet-500',
        iconBg: 'bg-violet-500/10 group-hover:bg-violet-500/20',
        titleKey: 'welcomeCardCreateTitle',
        descKey: 'welcomeCardCreateDesc',
        starterKey: 'welcomeCardCreateStarter',
    },
    {
        icon: BarChart2,
        iconColor: 'text-blue-500',
        iconBg: 'bg-blue-500/10 group-hover:bg-blue-500/20',
        titleKey: 'welcomeCardDocsTitle',
        descKey: 'welcomeCardDocsDesc',
        starterKey: 'welcomeCardDocsStarter',
    },
] as const

const DEFAULT_CHAT_TITLES = new Set(['New Chat', '新对话'])

export const WelcomeScreen: React.FC = () => {
    const t = useT()
    const navigate = useNavigate()
    const {
        activeChatId,
        chats,
        messages,
        createChat,
        setPendingQuickReply,
        firstRunChecklistDismissed,
        setFirstRunChecklistDismissed,
    } = useAppStore()
    const [hasNotebookEntry, setHasNotebookEntry] = React.useState(false)
    const [checklistLoading, setChecklistLoading] = React.useState(false)

    const hasSentMessage = React.useMemo(() => {
        const hasLoadedUserMessage = Object.values(messages).some((items) =>
            items.some((message) => message.role === 'user')
        )
        if (hasLoadedUserMessage) return true
        return chats.some((chat) => !DEFAULT_CHAT_TITLES.has(chat.title))
    }, [chats, messages])

    React.useEffect(() => {
        if (firstRunChecklistDismissed) return
        let cancelled = false
        setChecklistLoading(true)

        async function loadChecklistState() {
            try {
                const notebooks = await notebookListNotebooks().catch(() => [])
                if (cancelled) return

                let foundNotebookEntry = false
                for (const notebook of notebooks) {
                    const entries = await notebookList(notebook).catch(() => [])
                    if (cancelled) return
                    if (Array.isArray(entries) && entries.length > 0) {
                        foundNotebookEntry = true
                        break
                    }
                }
                setHasNotebookEntry(foundNotebookEntry)
            } finally {
                if (!cancelled) setChecklistLoading(false)
            }
        }

        void loadChecklistState()
        return () => { cancelled = true }
    }, [firstRunChecklistDismissed])

    const handleCardClick = (starter: string) => {
        if (!activeChatId) createChat()
        // Auto-send the starter message so the conversation begins immediately
        setPendingQuickReply(starter)
    }

    const focusComposer = () => {
        if (!activeChatId) createChat()
        requestAnimationFrame(() => {
            document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
        })
    }

    const checklistItems = [
        {
            id: 'message',
            icon: MessageSquare,
            done: hasSentMessage,
            title: t('firstRunChecklistMessageTitle'),
            desc: t('firstRunChecklistMessageDesc'),
            actionLabel: t('firstRunChecklistMessageAction'),
            onAction: focusComposer,
        },
        {
            id: 'notebook',
            icon: BookOpen,
            done: hasNotebookEntry,
            title: t('firstRunChecklistNotebookTitle'),
            desc: t('firstRunChecklistNotebookDesc'),
            actionLabel: t('firstRunChecklistNotebookAction'),
            onAction: () => navigate('/notebook/article/new?notebook=personal'),
        },
    ]

    return (
        <div className="flex flex-col items-center text-center px-2 py-6 sm:py-12 animate-fade-in">
            {/* Logo */}
            <div className="relative mb-4 sm:mb-6">
                <div className="absolute inset-0 bg-primary-mint/15 rounded-full blur-2xl scale-150" />
                <div className="relative">
                    <GhostLogo />
                </div>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold mb-2 tracking-tight text-text">{t('welcomeHeadline')}</h1>
            <p className="text-text-tertiary max-w-xs mb-6 sm:mb-10 text-xs sm:text-sm leading-relaxed">
                {t('welcomeTagline')}
            </p>

            {!firstRunChecklistDismissed && (
                <div className="w-full max-w-lg mb-5 sm:mb-7 text-left border border-border bg-bg-container rounded-xl p-3 sm:p-4" style={{ boxShadow: 'var(--shadow-soft)' }}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h2 className="text-sm font-semibold text-text leading-snug">{t('firstRunChecklistTitle')}</h2>
                            <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{t('firstRunChecklistSubtitle')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFirstRunChecklistDismissed(true)}
                            className="p-1.5 -mr-1 rounded-lg text-text-tertiary hover:text-text hover:bg-fill transition-colors shrink-0"
                            aria-label={t('firstRunChecklistDismiss')}
                            title={t('firstRunChecklistDismiss')}
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="space-y-2">
                        {checklistItems.map(({ id, icon: Icon, done, title, desc, actionLabel, onAction }) => {
                            const StatusIcon = done ? CheckCircle2 : Circle
                            return (
                                <div key={id} className="flex items-center gap-3 rounded-lg bg-fill/35 px-3 py-2.5">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <StatusIcon
                                            size={16}
                                            className={done ? 'text-primary-mint shrink-0' : checklistLoading ? 'text-text-quaternary animate-pulse shrink-0' : 'text-text-quaternary shrink-0'}
                                        />
                                        <Icon size={15} className="text-text-tertiary shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-text leading-snug truncate">{title}</p>
                                            <p className="text-[11px] text-text-tertiary leading-snug truncate">{desc}</p>
                                        </div>
                                    </div>
                                    {!done && (
                                        <button
                                            type="button"
                                            onClick={onAction}
                                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-primary-mint hover:bg-primary-mint/10 transition-colors shrink-0"
                                        >
                                            {actionLabel}
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full max-w-lg">
                {FEATURE_CARDS.map(({ icon: Icon, iconColor, iconBg, titleKey, descKey, starterKey }) => (
                    <button
                        key={titleKey}
                        onClick={() => handleCardClick(t(starterKey))}
                        className="group flex flex-col items-start p-3 sm:p-4 bg-bg-container border border-border rounded-2xl hover:border-border/80 hover:shadow-md transition-all duration-200 text-left active:scale-[0.97]"
                        style={{ boxShadow: 'var(--shadow-soft)' }}
                    >
                        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center mb-2 sm:mb-3 transition-colors ${iconBg}`}>
                            <Icon size={16} className={`sm:hidden ${iconColor}`} />
                            <Icon size={18} className={`hidden sm:block ${iconColor}`} />
                        </div>
                        <span className="text-xs sm:text-sm font-semibold text-text leading-snug">{t(titleKey)}</span>
                        <span className="text-[10px] sm:text-xs text-text-tertiary mt-0.5 leading-snug line-clamp-2">{t(descKey)}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
