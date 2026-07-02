import React from 'react'
import { Lock } from 'lucide-react'
import { login } from '../api'
import { t } from '../i18n'

export const Login: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
    const [value, setValue] = React.useState('')
    const [error, setError] = React.useState('')
    const [loading, setLoading] = React.useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        const result = await login(value)
        setLoading(false)
        if (result === 'ok') {
            onSuccess()
        } else if (result === 'unreachable') {
            setError(t('cannotReachServer'))
        } else {
            setError(t('invalidToken'))
        }
    }

    return (
        <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
            <div className="w-full max-w-sm p-8 bg-bg-container border border-border rounded-2xl animate-fade-in"
                 style={{ boxShadow: 'var(--shadow-elevated)' }}>
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-mint/20 to-primary-mint/5 border border-primary-mint/20 flex items-center justify-center mb-5"
                         style={{ boxShadow: '0 0 24px rgba(52, 211, 153, 0.15)' }}>
                        <Lock size={28} className="text-primary-mint" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('neoTitle')}</h1>
                    <p className="text-sm text-text-secondary mt-1.5">{t('enterAccessToken')}</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    <input
                        type="password"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={t('accessToken')}
                        autoFocus
                        className="w-full bg-fill-secondary border border-border rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/40 focus:border-primary-mint/50 transition-all duration-200 placeholder:text-text-quaternary"
                    />
                    {error && (
                        <p className="text-xs text-destructive px-1">{error}</p>
                    )}
                    <button
                        type="submit"
                        disabled={!value.trim() || loading}
                        className="w-full py-3.5 bg-gradient-to-b from-primary-mint to-emerald-600 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]"
                        style={{ boxShadow: value.trim() && !loading ? '0 2px 12px rgba(52, 211, 153, 0.3)' : 'none' }}
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="typing-dot" style={{ width: 4, height: 4 }} />
                                <span className="typing-dot" style={{ width: 4, height: 4 }} />
                                <span className="typing-dot" style={{ width: 4, height: 4 }} />
                            </span>
                        ) : t('signIn')}
                    </button>
                </form>
            </div>
        </div>
    )
}
