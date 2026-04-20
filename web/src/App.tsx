import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { MessageSquare, BookOpen, Cpu, Menu, X } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { NotebookPanel } from './components/NotebookPanel'
import { Login } from './components/Login'
import { WaterPuzzle } from './components/WaterPuzzle'
import { ModelPanel } from './components/ModelPanel'
import { useAppStore } from './stores/useAppStore'
import { checkAuth, type AuthResult } from './api'
import { cn } from './lib/utils'
import { ToastContainer } from './components/Toast'
import { ConfirmDialogContainer } from './components/ConfirmDialog'

const ResizeHandle: React.FC = () => (
    <PanelResizeHandle className="w-1 bg-transparent hover:bg-primary-mint/30 transition-all duration-200 cursor-col-resize group">
        <div className="w-full h-full flex items-center justify-center">
            <div className="w-px h-8 bg-border group-hover:bg-primary-mint/60 transition-colors rounded-full" />
        </div>
    </PanelResizeHandle>
)

// ── Top nav bar shared by all pages ───────────────────────────────────────

const TopNav: React.FC<{ onMenuClick?: () => void; menuOpen?: boolean }> = ({ onMenuClick, menuOpen }) => (
    <div className="h-11 md:h-12 border-b border-border bg-bg-container/80 backdrop-blur-xl flex items-center px-3 md:px-5 gap-1.5 shrink-0"
         style={{ boxShadow: 'var(--shadow-soft)' }}>
        {onMenuClick && (
            <button
                onClick={onMenuClick}
                className="md:hidden p-1.5 rounded-lg text-text-secondary hover:bg-fill transition-colors mr-0.5"
            >
                {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
        )}
        <div className="flex items-center gap-1.5 mr-2 md:mr-4">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary-mint to-emerald-600 flex items-center justify-center">
                <span className="text-white text-[10px] font-bold leading-none">N</span>
            </div>
            <span className="text-sm font-bold tracking-tight text-text hidden sm:inline">Neo</span>
        </div>
        {([
            { to: '/chat',     icon: <MessageSquare size={14} />, label: 'Chat' },
            { to: '/notebook', icon: <BookOpen size={14} />,      label: 'Notebook' },
            { to: '/models',   icon: <Cpu size={14} />,           label: 'Models' },
        ] as const).map(({ to, icon, label }) => (
            <NavLink
                key={to}
                to={to}
                className={({ isActive }) => cn(
                    'flex items-center gap-1.5 px-3 md:px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                    isActive
                        ? 'bg-primary-mint/12 text-text shadow-sm'
                        : 'text-text-secondary hover:bg-fill hover:text-text'
                )}
            >
                {icon}<span className="hidden sm:inline">{label}</span>
            </NavLink>
        ))}
    </div>
)

// ── /chat page ──────────────────────────────────────────────────────────────────

const ChatPage: React.FC<{ sidebarOpen: boolean; setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>> }> = ({ sidebarOpen, setSidebarOpen }) => {
    const [searchParams, setSearchParams] = useSearchParams()
    const { activeChatId, selectOrCreateChat, createChat } = useAppStore()

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

    // Close mobile sidebar when a chat is selected
    React.useEffect(() => {
        setSidebarOpen(false)
    }, [activeChatId])

    // Global keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey

            // Cmd/Ctrl+N: New chat
            if (isMod && e.key === 'n') {
                e.preventDefault()
                createChat()
            }

            // Cmd/Ctrl+B: Toggle sidebar (mobile)
            if (isMod && e.key === 'b') {
                e.preventDefault()
                setSidebarOpen((prev) => !prev)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [createChat])

    return (
        <div className="flex-1 overflow-hidden flex relative">
            {/* Mobile sidebar overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 md:hidden animate-fade-in"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Mobile sidebar drawer */}
            <div className={cn(
                'fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-out md:hidden pt-11',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            )}>
                <Sidebar />
            </div>

            {/* Desktop layout with resizable panels */}
            <div className="w-full hidden md:flex">
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

            {/* Mobile layout (no panels) */}
            <div className="flex-1 min-w-0 md:hidden">
                <ChatArea />
            </div>
        </div>
    )
}

// ── /notebook page ───────────────────────────────────────────────────────────

const NotebookPage: React.FC = () => {
    const { notebookName } = useParams<{ notebookName?: string }>()
    const navigate = useNavigate()
    return (
        <div className="flex-1 overflow-hidden">
            <NotebookPanel fullPage urlNotebook={notebookName} navigate={navigate} />
        </div>
    )
}

// ── Main shell (after auth) ──────────────────────────────────────────────────

const MainLayout: React.FC = () => {
    const { theme } = useAppStore()
    const [sidebarOpen, setSidebarOpen] = React.useState(false)

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    return (
        <div className="h-screen w-screen bg-bg-layout overflow-hidden text-text flex flex-col">
            <TopNav onMenuClick={() => setSidebarOpen((o) => !o)} menuOpen={sidebarOpen} />
            <Routes>
                <Route path="/chat"     element={<ChatPage sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />} />
                <Route path="/notebook" element={<NotebookPage />} />
                <Route path="/notebook/:notebookName" element={<NotebookPage />} />
                <Route path="/models"   element={<div className="flex-1 overflow-hidden flex flex-col min-h-0"><ModelPanel /></div>} />
                <Route path="/puzzle"   element={<div className="flex-1 overflow-hidden"><WaterPuzzle /></div>} />
                <Route path="*"         element={<Navigate to="/chat" replace />} />
            </Routes>
        </div>
    )
}

const ServerUnreachable: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
        <div className="text-center p-10 bg-bg-container border border-border rounded-2xl animate-fade-in"
             style={{ boxShadow: 'var(--shadow-elevated)' }}>
            <div className="w-12 h-12 mx-auto mb-5 rounded-2xl bg-warning/10 flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
            </div>
            <p className="text-text-secondary text-sm mb-3 font-medium">
                Cannot reach the backend server
            </p>
            <p className="text-text-tertiary text-xs mb-6 leading-relaxed">
                Start Neo with <code className="bg-fill px-1.5 py-0.5 rounded-md text-xs border border-border-secondary">WEB_PORT=3000 npm run dev:bot</code>&nbsp; then retry.
            </p>
            <button
                onClick={onRetry}
                className="px-5 py-2.5 bg-gradient-to-b from-primary-mint to-emerald-600 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ boxShadow: '0 2px 8px rgba(52, 211, 153, 0.3)' }}
            >
                Retry Connection
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
                <div className="flex flex-col items-center gap-4 animate-fade-in">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-mint to-emerald-600 flex items-center justify-center"
                         style={{ animation: 'glow-pulse 2s ease-in-out infinite' }}>
                        <span className="text-white text-sm font-bold">N</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                    </div>
                </div>
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
            <ToastContainer />
            <ConfirmDialogContainer />
        </BrowserRouter>
    )
}

export default App
