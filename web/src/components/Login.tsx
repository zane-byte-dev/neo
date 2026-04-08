import React from 'react'
import { Lock } from 'lucide-react'
import { saveToken } from '../api'
import { useAppStore } from '../stores/useAppStore'
import { checkAuth } from '../api'

export const Login: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
    const setToken = useAppStore((s) => s.setToken)
    const [value, setValue] = React.useState('')
    const [error, setError] = React.useState('')
    const [loading, setLoading] = React.useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        saveToken(value)
        setToken(value)
        const result = await checkAuth()
        setLoading(false)
        if (result === 'ok') {
            onSuccess()
        } else if (result === 'unreachable') {
            setError('Cannot reach server. Is the backend running?')
            saveToken('')
            setToken('')
        } else {
            setError('Invalid token.')
            saveToken('')
            setToken('')
        }
    }

    return (
        <div className="h-screen w-screen flex items-center justify-center bg-bg-layout">
            <div className="w-full max-w-sm p-8 bg-bg-container border border-border rounded-2xl shadow-xl animate-fade-in">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-14 h-14 bg-primary-mint/10 border border-primary-mint/30 rounded-2xl flex items-center justify-center mb-4">
                        <Lock size={28} className="text-primary-mint" />
                    </div>
                    <h1 className="text-2xl font-bold">Neo</h1>
                    <p className="text-sm text-text-secondary mt-1">Enter your access token</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <input
                        type="password"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Access token"
                        autoFocus
                        className="w-full bg-fill-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary-mint"
                    />
                    {error && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}
                    <button
                        type="submit"
                        disabled={!value.trim() || loading}
                        className="w-full py-3 bg-primary-mint text-white font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
                    >
                        {loading ? 'Checking…' : 'Sign in'}
                    </button>
                </form>
            </div>
        </div>
    )
}
