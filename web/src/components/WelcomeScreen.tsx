import React from 'react'
import { Sparkles, BookOpen, MessageSquare } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

export const WelcomeScreen: React.FC = () => {
    const createChat = useAppStore((s) => s.createChat)
    return (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-8 animate-fade-in">
            {/* Glow icon */}
            <div className="relative mb-6 sm:mb-8">
                <div className="absolute inset-0 bg-primary-mint/20 rounded-full blur-2xl scale-150" />
                <div className="relative w-16 sm:w-20 h-16 sm:h-20 bg-gradient-to-br from-primary-mint/15 to-primary-mint/5 rounded-2xl sm:rounded-3xl flex items-center justify-center border border-primary-mint/20"
                     style={{ boxShadow: '0 0 32px rgba(52, 211, 153, 0.15)' }}>
                    <Sparkles size={30} className="text-primary-mint sm:hidden" fill="currentColor" />
                    <Sparkles size={36} className="text-primary-mint hidden sm:block" fill="currentColor" />
                </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold mb-2 sm:mb-3 tracking-tight text-text">Neo</h1>
            <p className="text-text-secondary max-w-md mb-8 sm:mb-12 text-sm sm:text-[15px] leading-relaxed">
                Your local AI assistant with access to tools, files, and your knowledge base.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-sm w-full">
                <button
                    onClick={createChat}
                    className="group flex flex-col items-start p-4 sm:p-5 bg-bg-container border border-border rounded-2xl hover:border-primary-mint/40 transition-all duration-200 text-left hover:scale-[1.02] active:scale-[0.98]"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                >
                    <div className="w-9 h-9 rounded-xl bg-primary-mint/10 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:bg-primary-mint/15 transition-colors">
                        <MessageSquare size={18} className="text-primary-mint" />
                    </div>
                    <span className="text-sm font-semibold">New Chat</span>
                    <span className="text-xs text-text-tertiary mt-1">Start a conversation</span>
                </button>
                <button
                    onClick={() => {
                        document.dispatchEvent(new CustomEvent('open-notebook'))
                    }}
                    className="group flex flex-col items-start p-4 sm:p-5 bg-bg-container border border-border rounded-2xl hover:border-accent-indigo/40 transition-all duration-200 text-left hover:scale-[1.02] active:scale-[0.98]"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                >
                    <div className="w-9 h-9 rounded-xl bg-accent-indigo/10 flex items-center justify-center mb-2.5 sm:mb-3 group-hover:bg-accent-indigo/15 transition-colors">
                        <BookOpen size={18} className="text-accent-indigo" />
                    </div>
                    <span className="text-sm font-semibold">Notebook</span>
                    <span className="text-xs text-text-tertiary mt-1">Browse knowledge base</span>
                </button>
            </div>
        </div>
    )
}
