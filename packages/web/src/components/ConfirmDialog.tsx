/**
 * ConfirmDialog — modal confirmation replacement for window.confirm().
 *
 * Usage:
 *   import { confirm } from './ConfirmDialog'
 *   const ok = await confirm('Delete this note?')
 *   if (ok) { ... }
 *
 * Mount <ConfirmDialogContainer /> once at the app root.
 */
import React from 'react'
import { AlertTriangle } from 'lucide-react'

// ── Global imperative API ────────────────────────────────────────────────────

interface ConfirmState {
    message: string
    description?: string
    confirmText?: string
    cancelText?: string
    destructive?: boolean
    resolve: (ok: boolean) => void
}

let _state: ConfirmState | null = null
let _listeners: Array<() => void> = []

function notify() {
    _listeners.forEach((l) => l())
}

export function confirm(
    message: string,
    opts?: { description?: string; confirmText?: string; cancelText?: string; destructive?: boolean },
): Promise<boolean> {
    return new Promise((resolve) => {
        _state = { message, ...opts, resolve }
        notify()
    })
}

function close(ok: boolean) {
    const s = _state
    _state = null
    notify()
    s?.resolve(ok)
}

// ── React component ──────────────────────────────────────────────────────────

export const ConfirmDialogContainer: React.FC = () => {
    const [, forceUpdate] = React.useReducer((c: number) => c + 1, 0)

    React.useEffect(() => {
        const handler = () => forceUpdate()
        _listeners.push(handler)
        return () => { _listeners = _listeners.filter((l) => l !== handler) }
    }, [])

    if (!_state) return null

    const { message, description, confirmText, cancelText, destructive } = _state

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => close(false)}>
            <div
                className="bg-bg-container rounded-2xl shadow-2xl w-[380px] max-w-[92vw] p-5 animate-slide-up"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3 mb-4">
                    <div className={`p-2 rounded-xl ${destructive ? 'bg-destructive/10' : 'bg-warning/10'}`}>
                        <AlertTriangle size={18} className={destructive ? 'text-destructive' : 'text-warning'} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-sm font-semibold text-text">{message}</h3>
                        {description && <p className="text-xs text-text-tertiary mt-1">{description}</p>}
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={() => close(false)}
                        className="px-3.5 py-2 text-xs font-medium bg-fill-secondary hover:bg-fill rounded-lg transition-colors"
                    >
                        {cancelText ?? '取消'}
                    </button>
                    <button
                        onClick={() => close(true)}
                        className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors ${
                            destructive
                                ? 'bg-destructive text-white hover:bg-destructive/90'
                                : 'bg-primary-mint text-white hover:bg-primary-mint/90'
                        }`}
                    >
                        {confirmText ?? '确认'}
                    </button>
                </div>
            </div>
        </div>
    )
}
