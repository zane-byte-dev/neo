import React from 'react'
import { FolderOpen, PenLine, BarChart2 } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

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
        title: '文件整理',
        desc: '智能整理和管理本地文件',
        starter: '帮我整理和管理本地文件，',
    },
    {
        icon: PenLine,
        iconColor: 'text-violet-500',
        iconBg: 'bg-violet-500/10 group-hover:bg-violet-500/20',
        title: '内容创作',
        desc: '创作演示文稿、文档和多媒体内容',
        starter: '帮我创作一份',
    },
    {
        icon: BarChart2,
        iconColor: 'text-blue-500',
        iconBg: 'bg-blue-500/10 group-hover:bg-blue-500/20',
        title: '文档处理',
        desc: '处理和分析文档数据',
        starter: '帮我处理和分析这份文档，',
    },
]

export const WelcomeScreen: React.FC = () => {
    const { activeChatId, createChat, setInputValue } = useAppStore()

    const handleCardClick = (starter: string) => {
        if (!activeChatId) createChat()
        setInputValue(starter)
        // Focus the textarea after a tick so it's rendered with the new value
        requestAnimationFrame(() => {
            const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
            textarea?.focus()
            const len = starter.length
            textarea?.setSelectionRange(len, len)
        })
    }

    return (
        <div className="flex flex-col items-center text-center px-2 py-6 sm:py-12 animate-fade-in">
            {/* Logo */}
            <div className="relative mb-4 sm:mb-6">
                <div className="absolute inset-0 bg-primary-mint/15 rounded-full blur-2xl scale-150" />
                <div className="relative">
                    <GhostLogo />
                </div>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold mb-2 tracking-tight text-text">不止聊天，搞定一切</h1>
            <p className="text-text-tertiary max-w-xs mb-6 sm:mb-10 text-xs sm:text-sm leading-relaxed">
                本地运行、自主规划、安全可控的 AI 工作搭子
            </p>

            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full max-w-lg">
                {FEATURE_CARDS.map(({ icon: Icon, iconColor, iconBg, title, desc, starter }) => (
                    <button
                        key={title}
                        onClick={() => handleCardClick(starter)}
                        className="group flex flex-col items-start p-3 sm:p-4 bg-bg-container border border-border rounded-2xl hover:border-border/80 hover:shadow-md transition-all duration-200 text-left active:scale-[0.97]"
                        style={{ boxShadow: 'var(--shadow-soft)' }}
                    >
                        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center mb-2 sm:mb-3 transition-colors ${iconBg}`}>
                            <Icon size={16} className={`sm:hidden ${iconColor}`} />
                            <Icon size={18} className={`hidden sm:block ${iconColor}`} />
                        </div>
                        <span className="text-xs sm:text-sm font-semibold text-text leading-snug">{title}</span>
                        <span className="text-[10px] sm:text-xs text-text-tertiary mt-0.5 leading-snug line-clamp-2">{desc}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
