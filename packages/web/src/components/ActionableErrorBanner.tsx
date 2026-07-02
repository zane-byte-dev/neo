import React from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'

export const ActionableErrorBanner: React.FC<{
    title: string
    message: string
    detail?: string | null
    detailsLabel?: string
    actionLabel?: string
    onAction?: () => void
    secondaryActionLabel?: string
    onSecondaryAction?: () => void
}> = ({ title, message, detail, detailsLabel, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }) => (
    <div className="rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-2.5">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0">
                    <p className="text-xs font-semibold text-text">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{message}</p>
                    {detail && detailsLabel && (
                        <details className="mt-2 text-[11px] text-text-tertiary">
                            <summary className="cursor-pointer select-none font-medium text-text-secondary">{detailsLabel}</summary>
                            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-secondary bg-bg-container p-2 font-mono leading-relaxed">
                                {detail}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
            {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    {secondaryActionLabel && onSecondaryAction && (
                        <button
                            type="button"
                            onClick={onSecondaryAction}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-container px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-fill"
                        >
                            {secondaryActionLabel}
                        </button>
                    )}
                    {actionLabel && onAction && (
                        <button
                            type="button"
                            onClick={onAction}
                            className="inline-flex items-center gap-1 rounded-lg bg-primary-mint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                        >
                            {actionLabel}
                            <ChevronRight size={13} />
                        </button>
                    )}
                </div>
            ) : null}
        </div>
    </div>
)
