import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useSearchParams } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { MessageSquare, BookOpen } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { NotebookPanel } from './components/NotebookPanel'
import { Login } from './components/Login'
import { useAppStore } from './stores/useAppStore'
import { checkAuth, type AuthResult } from './api'
import { cn } from './lib/utils'

const ResizeHandle: React.FC = () => (
    <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary-mint/40 transition-colors cursor-col-resize" />
)

// ── Top nav bar shared by all pages ───────────────────────────────────────

const TopNav: React.FC = () => (
    <div className="h-10 border-b border-border bg-bg-container flex items-center px-4 gap-1 shrink-0">
        <span className="text-sm font-bold text-text mr-3">Neo</span>
        {([
            { to: '/chat',     icon: <MessageSquare size={14} />, label: 'Chat' },
            { to: '/notebook', icon: <BookOpen size={14} />,      label: 'Notebook' },
        ] as const).map(({ to, icon, label }) => (
            <NavLink
                key={to}
                to={to}
                className={({ isActive }) => cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    isActive
                        ? 'bg-primary-mint/15 text-text'
                        : 'text-text-secondary hover:bg-fill-secondary hover:text-text'
                )}
            >
                {icon}{label}
            </NavLink>
        ))}
    </div>
)

// ── /chat page ──────────────────────────────────────────────────────────────────

const ChatPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams()
    const { activeChatId, selectOrCreateChat } = useAppStore()

    // On mount: if ?sessionId is in the URL, activate that chat
    React.useEffect(() => {
        const sessionId = searchParams.get('sessionId')
        if (sessionId) {
            selectOrCreateChat(sessionId)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Keep URL in sync when active chat changes
    React.useEffect(() => {
        if (activeChatId) {
            setSearchParams({ sessionId: activeChatId }, { replace: true })
        } else {
            setSearchParams({}, { replace: true })
        }
    }, [activeChatId, setSearchParams])

    return (
        <div className="flex-1 overflow-hidden flex">
            <PanelGroup direction="horizontal" className="w-full">
                <Panel defaultSize={24} minSize={16} maxSize={38}>
                    <Sidebar />
                </Panel>
                <ResizeHandle />
                <Panel defaultSize={76} minSize={40}>
                    <ChatArea />
                </Panel>
            </PanelGroup>
        </div>
    )
}

// ── /notebook page ───────────────────────────────────────────────────────────

const NotebookPage: React.FC = () => (
    <div className="flex-1 overflow-hidden">
        <NotebookPanel fullPage />
    </div>
)

// ── Main shell (after auth) ──────────────────────────────────────────────────

const MainLayout: React.FC = () => {
    const { theme } = useAppStore()

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    return (
        <div className="h-screen w-screen bg-bg-layout overflow-hidden text-text flex flex-col font-sans">
            <TopNav />
            <Routes>
                <Route path="/chat"     element={<ChatPage />} />
                <Route path="/notebook" element={<NotebookPage />} />
                <Route path="*"         element={<Navigate to="/chat" replace />} />
            </Routes>
        </div>
    )
}

const ServerUnreachable: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
        <div className="text-center p-8">
            <p className="text-text-secondary text-sm mb-4">
                Cannot reach the backend server on <code className="bg-fill px-1.5 py-0.5 rounded text-xs">localhost:3000</code>.
            </p>
            <p className="text-text-tertiary text-xs mb-6">
                Start Neo with <code className="bg-fill px-1.5 py-0.5 rounded">WEB_PORT=3000 npm run dev:bot</code>&nbsp; then retry.
            </p>
            <button
                onClick={onRetry}
                className="px-4 py-2 bg-primary-mint/20 border border-primary-mint/40 text-text rounded-lg text-sm hover:bg-primary-mint/30 transition-colors"
            >
                Retry
            </button>
        </div>
    </div>
)

const App: React.FC = () => {
    const { theme } = useAppStore()
    const [authState, setAuthState] = React.useState<AuthResult | 'loading'>('loading')

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    const runAuthCheck = React.useCallback(() => {
        setAuthState('loading')
        checkAuth().then(setAuthState)
    }, [])

    React.useEffect(() => { runAuthCheck() }, [])

    if (authState === 'loading') {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
                <span className="text-text-tertiary text-sm">Loading…</span>
            </div>
        )
    }

    if (authState === 'unreachable') {
        return <ServerUnreachable onRetry={runAuthCheck} />
    }

    if (authState === 'unauthorized') {
        return <Login onSuccess={runAuthCheck} />
    }

    return (
        <BrowserRouter>
            <MainLayout />
        </BrowserRouter>
    )
}

export default App
