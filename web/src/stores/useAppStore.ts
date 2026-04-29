import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState } from '../types'
import { createUiSlice } from './slices/uiSlice'
import { createChatSlice } from './slices/chatSlice'
import { createNotebookSlice } from './slices/notebookSlice'

type PersistedAppStore = Pick<AppState, 'theme' | 'locale' | 'selectedModel' | 'confirmDangerous'>

const WEB_STORE_VERSION = 2

export const useAppStore = create<AppState>()(
    persist(
        (...a) => ({
            ...createUiSlice(...a),
            ...createChatSlice(...a),
            ...createNotebookSlice(...a),
        }),
        {
            name: 'neo-web-store',
            version: WEB_STORE_VERSION,
            migrate: (persistedState, version): PersistedAppStore => {
                const state = (persistedState ?? {}) as Partial<PersistedAppStore> & { autoSpeak?: boolean }
                if (version < WEB_STORE_VERSION) {
                    // Drop deprecated autoSpeak flag from older persisted state.
                    const { autoSpeak: _autoSpeak, ...rest } = state
                    void _autoSpeak
                    return {
                        ...rest,
                        confirmDangerous: rest.confirmDangerous ?? true,
                    } as PersistedAppStore
                }
                return state as PersistedAppStore
            },
            // Persist chats + messages + theme, not UI state
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
                selectedModel: state.selectedModel,
                confirmDangerous: state.confirmDangerous,
            }),
        }
    )
)
