import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState } from '../types'
import { createUiSlice } from './slices/uiSlice'
import { createChatSlice } from './slices/chatSlice'
import { createNotebookSlice } from './slices/notebookSlice'

export const useAppStore = create<AppState>()(
    persist(
        (...a) => ({
            ...createUiSlice(...a),
            ...createChatSlice(...a),
            ...createNotebookSlice(...a),
        }),
        {
            name: 'neo-web-store',
            // Persist chats + messages + theme, not UI state
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
                selectedModel: state.selectedModel,
                autoSpeak: state.autoSpeak,
                confirmDangerous: state.confirmDangerous,
            }),
        }
    )
)
