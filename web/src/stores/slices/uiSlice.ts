import type { StateCreator } from 'zustand'
import type { Theme, AppState } from '../../types'
import type { Locale } from '../../i18n'

export interface UiSlice {
    theme: Theme
    setTheme: (theme: Theme) => void
    locale: Locale
    setLocale: (locale: Locale) => void
    /** When true, dangerous-tier tools pause for user confirmation. */
    confirmDangerous: boolean
    setConfirmDangerous: (v: boolean) => void
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
    theme: 'light' as Theme,
    setTheme: (theme: Theme) => {
        document.documentElement.setAttribute('data-theme', theme)
        set({ theme })
    },
    locale: (navigator.language?.startsWith('zh') ? 'zh' : 'en') as Locale,
    setLocale: (locale: Locale) => set({ locale }),
    confirmDangerous: true,
    setConfirmDangerous: (v: boolean) => set({ confirmDangerous: v }),
})
