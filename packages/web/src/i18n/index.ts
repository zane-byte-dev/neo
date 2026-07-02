import React from 'react'
import { useAppStore } from '../stores/useAppStore'
import en, { type TranslationKeys } from './locales/en'
import zh from './locales/zh'

export type Locale = 'en' | 'zh'

const locales: Record<Locale, Record<TranslationKeys, string>> = { en, zh }

export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
]

export function t(key: TranslationKeys, params?: Record<string, string | number>): string {
    const locale = useAppStore.getState().locale
    let text = locales[locale]?.[key] ?? locales.en[key] ?? key
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, String(v))
        }
    }
    return text
}

/** React hook version — triggers re-render on locale change */
export function useT() {
    const locale = useAppStore((s) => s.locale)
    return React.useCallback((key: TranslationKeys, params?: Record<string, string | number>): string => {
        let text = locales[locale]?.[key] ?? locales.en[key] ?? key
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(`{${k}}`, String(v))
            }
        }
        return text
    }, [locale])
}
