import React from 'react'
import { Sparkles, BookOpen, MessageSquare } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

export const WelcomeScreen: React.FC = () => {
    const createChat = useAppStore((s) => s.createChat)
    return (
        <div className="h-full flex flex-col items-center justify-center text-center p-8 animate-fade-in">
            <div className="w-16 h-16 bg-primary-mint/10 rounded-3xl flex items-center justify-center mb-6 border border-primary-mint/20">
                <Sparkles size={32} className="text-primary-mint" fill="currentColor" />
            </div>

            <h1 className="text-3xl font-bold mb-3 tracking-tight">Neo</h1>
            <p className="text-text-secondary max-w-md mb-10 text-base leading-relaxed">
                Your local AI assistant with access to tools, files, and your knowledge base.
            </p>

            <div className="grid grid-cols-2 gap-3 max-w-sm w-full">
                <button
                    onClick={createChat}
                    className="flex flex-col items-start p-4 bg-fill-secondary border border-border rounded-xl hover:border-primary-mint/50 transition-colors text-left"
                >
                    <MessageSquare size={18} className="text-primary-mint mb-2" />
                    <span className="text-sm font-medium">New Chat</span>
                    <span className="text-xs text-text-tertiary mt-0.5">Start a conversation</span>
                </button>
                <button
                    onClick={() => {
                        // Switch focus to notebook panel — handled by App level
                        document.dispatchEvent(new CustomEvent('open-notebook'))
                    }}
                    className="flex flex-col items-start p-4 bg-fill-secondary border border-border rounded-xl hover:border-primary-mint/50 transition-colors text-left"
                >
                    <BookOpen size={18} className="text-primary-mint mb-2" />
                    <span className="text-sm font-medium">Notebook</span>
                    <span className="text-xs text-text-tertiary mt-0.5">Browse knowledge base</span>
                </button>
            </div>
        </div>
    )
}
