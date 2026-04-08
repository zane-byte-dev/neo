import React from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { NotebookPanel } from './components/NotebookPanel'
import { Login } from './components/Login'
import { useAppStore } from './stores/useAppStore'
import { getToken, checkAuth } from './api'

const ResizeHandle: React.FC = () => (
    <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary-mint/40 transition-colors cursor-col-resize" />
)

const MainLayout: React.FC = () => {
    const { theme } = useAppStore()

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    return (
        <div className="h-screen w-screen bg-bg-layout overflow-hidden text-text flex flex-col font-sans">
            <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
                <Panel defaultSize={22} minSize={16} maxSize={35}>
                    <Sidebar />
                </Panel>

                <ResizeHandle />

                <Panel defaultSize={50} minSize={30}>
                    <ChatArea />
                </Panel>

                <ResizeHandle />

                <Panel defaultSize={28} minSize={20} maxSize={45}>
                    <NotebookPanel />
                </Panel>
            </PanelGroup>
        </div>
    )
}

const App: React.FC = () => {
    const { theme } = useAppStore()
    const [authed, setAuthed] = React.useState<boolean | null>(null)

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    // Check auth on mount
    React.useEffect(() => {
        const token = getToken()
        if (!token) {
            setAuthed(false)
            return
        }
        checkAuth().then(setAuthed)
    }, [])

    if (authed === null) {
        // Loading / checking auth
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
                <span className="text-text-tertiary text-sm">Loading…</span>
            </div>
        )
    }

    if (!authed) {
        return <Login onSuccess={() => setAuthed(true)} />
    }

    return <MainLayout />
}

export default App
