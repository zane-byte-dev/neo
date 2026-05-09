import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from 'react-resizable-panels'
import { PanelLeftOpen } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { NoteEditor } from './components/NoteEditor'
import { NotebookWorkspace } from './components/notebook/NotebookWorkspace'
import { Login } from './components/Login'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppStore } from './stores/useAppStore'
import { checkAuth, type AuthResult } from './api'
import { ToastContainer } from './components/Toast'
import { ConfirmDialogContainer } from './components/ConfirmDialog'

const ResizeHandle: React.FC = () => (
    <PanelResizeHandle className="w-1 bg-transparent hover:bg-primary-mint/30 transition-all duration-200 cursor-col-resize group">
        <div className="w-full h-full flex items-center justify-center">
            <div className="w-px h-8 bg-border group-hover:bg-primary-mint/60 transition-colors rounded-full" />
        </div>
    </PanelResizeHandle>
)

// ── /chat page ──────────────────────────────────────────────────────────────────

const ChatPage: React.FC = () => {
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

    // Global keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey
            if (isMod && e.key === 'n') {
                e.preventDefault()
                createChat()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [createChat])

    return <ChatArea />
}

// ── /notebook/:notebookName page ────────────────────────────────────────────

const NotebookPage: React.FC = () => {
    const { notebookName } = useParams<{ notebookName?: string }>()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const articleId = searchParams.get('article') ?? undefined
    if (!notebookName) return null
    return (
        <div className="flex-1 overflow-hidden">
            <NotebookWorkspace
                notebook={notebookName}
                onBack={() => navigate('/chat')}
                startCollapsed
                initialArticleId={articleId}
            />
        </div>
    )
}

// ── /notebook/article/new page ───────────────────────────────────────────────

const NewNotePage: React.FC = () => {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const notebook = searchParams.get('notebook') ?? 'personal'

    return (
        <div className="flex-1 overflow-hidden">
            <NoteEditor
                note={null}
                notebook={notebook}
                onBack={() => navigate('/chat')}
                onSaved={() => navigate('/chat')}
            />
        </div>
    )
}

// ── Main shell (after auth) ──────────────────────────────────────────────────

const MainLayout: React.FC = () => {
    const { theme } = useAppStore()
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
    const sidebarPanelRef = React.useRef<ImperativePanelHandle>(null)

    const toggleSidebar = React.useCallback(() => {
        if (sidebarCollapsed) {
            sidebarPanelRef.current?.expand()
        } else {
            sidebarPanelRef.current?.collapse()
        }
    }, [sidebarCollapsed])

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    // Single Routes instance shared between mobile and desktop layouts
    const pageRoutes = (
        <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/notebook/article/new" element={<NewNotePage />} />
            <Route path="/notebook/:notebookName" element={<NotebookPage />} />
            <Route path="/settings" element={<div className="flex-1 overflow-hidden flex flex-col min-h-0"><SettingsPanel /></div>} />
            <Route path="/settings/:tab" element={<div className="flex-1 overflow-hidden flex flex-col min-h-0"><SettingsPanel /></div>} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
    )

    return (
        <div className="h-screen w-screen bg-bg-layout overflow-hidden text-text flex flex-row">
            <PanelGroup direction="horizontal" className="w-full">
                <Panel
                    ref={sidebarPanelRef}
                    defaultSize={20}
                    minSize={14}
                    maxSize={32}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => setSidebarCollapsed(true)}
                    onExpand={() => setSidebarCollapsed(false)}
                >
                    <Sidebar onCollapse={toggleSidebar} />
                </Panel>
                {!sidebarCollapsed && <ResizeHandle />}
                <Panel defaultSize={80} minSize={50}>
                    <div className="h-full flex flex-col overflow-hidden relative">
                        {/* Expand button shown when sidebar is collapsed */}
                        {sidebarCollapsed && (
                            <button
                                onClick={toggleSidebar}
                                className="absolute top-3 left-3 z-10 p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-fill border border-border bg-bg-container/80 backdrop-blur-xl transition-all duration-150"
                                style={{ boxShadow: 'var(--shadow-soft)' }}
                                title="Expand sidebar"
                            >
                                <PanelLeftOpen size={15} />
                            </button>
                        )}
                        {pageRoutes}
                    </div>
                </Panel>
            </PanelGroup>
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
