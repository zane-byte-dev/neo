/**
 * Toast — lightweight notification system.
 * Usage:
 *   import { toast } from './Toast'
 *   toast.success('Saved!')
 *   toast.error('Something went wrong')
 *   toast.warning('Please select a source')
 *   toast.info('Processing…')
 *
 * Mount <ToastContainer /> once at the app root.
 */
import React from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
    id: number
    type: ToastType
    message: string
    duration: number
}

// ── Global state (outside React to allow imperative API) ─────────────────────

let _nextId = 0
let _listeners: Array<() => void> = []
let _toasts: ToastItem[] = []

function notify() {
    _listeners.forEach((l) => l())
}

function add(type: ToastType, message: string, duration = 3000) {
    const item: ToastItem = { id: ++_nextId, type, message, duration }
    _toasts = [..._toasts, item]
    notify()
    if (duration > 0) {
        setTimeout(() => remove(item.id), duration)
    }
}

function remove(id: number) {
    _toasts = _toasts.filter((t) => t.id !== id)
    notify()
}

export const toast = {
    success: (msg: string, duration?: number) => add('success', msg, duration),
    error: (msg: string, duration?: number) => add('error', msg, duration ?? 4000),
    warning: (msg: string, duration?: number) => add('warning', msg, duration),
    info: (msg: string, duration?: number) => add('info', msg, duration),
}

// ── React component ──────────────────────────────────────────────────────────

const ICON: Record<ToastType, React.ComponentType<{ size?: number; className?: string }>> = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
}

const STYLE: Record<ToastType, string> = {
    success: 'bg-success/10 border-success/30 text-success',
    error: 'bg-destructive/10 border-destructive/30 text-destructive',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    info: 'bg-info/10 border-info/30 text-info',
}

export const ToastContainer: React.FC = () => {
    const [, forceUpdate] = React.useReducer((c: number) => c + 1, 0)

    React.useEffect(() => {
        const handler = () => forceUpdate()
        _listeners.push(handler)
        return () => { _listeners = _listeners.filter((l) => l !== handler) }
    }, [])

    if (_toasts.length === 0) return null

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm">
            {_toasts.map((t) => {
                const Icon = ICON[t.type]
                return (
                    <div
                        key={t.id}
                        className={`pointer-events-auto flex items-start gap-2 px-3.5 py-2.5 rounded-xl border text-sm shadow-lg animate-slide-up ${STYLE[t.type]} bg-bg-container`}
                    >
                        <Icon size={16} className="shrink-0 mt-0.5" />
                        <span className="flex-1 text-text text-sm">{t.message}</span>
                        <button onClick={() => remove(t.id)} className="shrink-0 p-0.5 hover:opacity-70 transition-opacity">
                            <X size={13} />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
