import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState } from '../types'
import { createUiSlice } from './slices/uiSlice'
import { createChatSlice } from './slices/chatSlice'
import { createNotebookSlice } from './slices/notebookSlice'

type PersistedAppStore = Pick<AppState, 'theme' | 'locale' | 'selectedModel' | 'confirmDangerous' | 'firstRunChecklistDismissed' | 'chats'>

const WEB_STORE_VERSION = 4

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
                        firstRunChecklistDismissed: rest.firstRunChecklistDismissed ?? false,
                    } as PersistedAppStore
                }
                return state as PersistedAppStore
            },
            // Persist chats (for per-chat model) + theme, not UI state
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
                selectedModel: state.selectedModel,
                confirmDangerous: state.confirmDangerous,
                firstRunChecklistDismissed: state.firstRunChecklistDismissed,
                chats: state.chats,
            }),
        }
    )
)
