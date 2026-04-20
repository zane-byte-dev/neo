import type { StateCreator } from 'zustand'
import type {
    AppState, SourceMeta, SourceGuide,
    NotebookChatMessage, NotebookNote, Artifact, NotebookConfig,
} from '../../types'

export interface NotebookSlice {
    activeNotebook: string | null
    setActiveNotebook: (name: string | null) => void
    sources: SourceMeta[]
    setSources: (sources: SourceMeta[]) => void
    selectedSourceIds: string[]
    setSelectedSourceIds: (ids: string[]) => void
    toggleSourceSelected: (id: string) => void
    sourceGuides: Record<string, SourceGuide | null>
    setSourceGuide: (id: string, guide: SourceGuide | null) => void
    notebookMessages: NotebookChatMessage[]
    setNotebookMessages: (messages: NotebookChatMessage[]) => void
    appendNotebookMessage: (message: NotebookChatMessage) => void
    updateLastNotebookMessage: (partial: Partial<NotebookChatMessage>) => void
    notebookNotes: NotebookNote[]
    setNotebookNotes: (notes: NotebookNote[]) => void
    notebookArtifacts: Artifact[]
    setNotebookArtifacts: (artifacts: Artifact[]) => void
    notebookConfig: NotebookConfig | null
    setNotebookConfig: (config: NotebookConfig | null) => void
}

export const createNotebookSlice: StateCreator<AppState, [], [], NotebookSlice> = (set) => ({
    activeNotebook: null,
    setActiveNotebook: (name: string | null) => set({
        activeNotebook: name,
        sources: [],
        selectedSourceIds: [],
        sourceGuides: {},
        notebookMessages: [],
        notebookNotes: [],
        notebookArtifacts: [],
        notebookConfig: null,
    }),
    sources: [],
    setSources: (sources: SourceMeta[]) => set({ sources }),
    selectedSourceIds: [],
    setSelectedSourceIds: (ids: string[]) => set({ selectedSourceIds: ids }),
    toggleSourceSelected: (id: string) => set((state) => ({
        selectedSourceIds: state.selectedSourceIds.includes(id)
            ? state.selectedSourceIds.filter((x) => x !== id)
            : [...state.selectedSourceIds, id],
    })),
    sourceGuides: {},
    setSourceGuide: (id: string, guide: SourceGuide | null) => set((state) => ({
        sourceGuides: { ...state.sourceGuides, [id]: guide },
    })),
    notebookMessages: [],
    setNotebookMessages: (messages: NotebookChatMessage[]) => set({ notebookMessages: messages }),
    appendNotebookMessage: (message: NotebookChatMessage) => set((state) => ({
        notebookMessages: [...state.notebookMessages, message],
    })),
    updateLastNotebookMessage: (partial: Partial<NotebookChatMessage>) => set((state) => {
        const msgs = [...state.notebookMessages]
        if (!msgs.length) return {}
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...partial }
        return { notebookMessages: msgs }
    }),
    notebookNotes: [],
    setNotebookNotes: (notes: NotebookNote[]) => set({ notebookNotes: notes }),
    notebookArtifacts: [],
    setNotebookArtifacts: (artifacts: Artifact[]) => set({ notebookArtifacts: artifacts }),
    notebookConfig: null,
    setNotebookConfig: (config: NotebookConfig | null) => set({ notebookConfig: config }),
})
