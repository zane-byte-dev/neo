import React from 'react'
import { AlertCircle, Check, Copy, RefreshCw, Square, Volume2 } from 'lucide-react'
import { copyTextToClipboard } from '../../lib/clipboard'
import { speakText, stripMarkdownForSpeech } from '../../lib/speech'
import { cn } from '../../lib/utils'
import { t } from '../../i18n'
import type { Message, MessagePart } from '../../types'
import { toast } from '../Toast'

export function messageMainText(msg: Message): string {
    if (msg.parts?.length) {
        return msg.parts
            .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
            .map((part) => part.content)
            .join('\n\n')
    }
    return msg.content ?? ''
}

export function CopyReplyButton({ text }: { text: string }) {
    const [copied, setCopied] = React.useState(false)
    const resetTimer = React.useRef<number | null>(null)

    React.useEffect(() => {
        return () => {
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
        }
    }, [])

    if (!text.trim()) return null

    const handleClick = async () => {
        try {
            await copyTextToClipboard(text)
            setCopied(true)
            toast.success(t('replyCopied'), 1600)
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
            resetTimer.current = window.setTimeout(() => setCopied(false), 1600)
        } catch {
            toast.error(t('copyReplyFailed'))
        }
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer',
                copied
                    ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
            )}
            title={copied ? t('replyCopied') : t('copyReply')}
            aria-label={copied ? t('replyCopied') : t('copyReply')}
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
    )
}

export function SpeakButton({ text }: { text: string }) {
    const [isSpeaking, setIsSpeaking] = React.useState(false)

    React.useEffect(() => {
        return () => {
            if (isSpeaking && typeof window !== 'undefined') {
                window.speechSynthesis?.cancel()
            }
        }
    }, [isSpeaking])

    if (typeof window === 'undefined' || !window.speechSynthesis) return null
    if (!stripMarkdownForSpeech(text)) return null

    const handleClick = () => {
        if (isSpeaking) {
            window.speechSynthesis.cancel()
            setIsSpeaking(false)
            return
        }
        setIsSpeaking(true)
        speakText(text, () => setIsSpeaking(false))
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer',
                isSpeaking
                    ? 'text-primary-mint bg-primary-mint/10 hover:bg-primary-mint/20'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
            )}
            title={isSpeaking ? t('stopSpeaking') : t('speakMessage')}
            aria-label={isSpeaking ? t('stopSpeaking') : t('speakMessage')}
        >
            {isSpeaking ? <Square size={13} /> : <Volume2 size={13} />}
        </button>
    )
}

export function isErrorMessage(content: string | undefined): boolean {
    if (!content) return false
    const trimmed = content.trim()
    return trimmed.startsWith('⚠️') || trimmed.startsWith('Stream error:')
}

export const ErrorMessageCard: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
    const clean = message.trim().replace(/^⚠️\s*/, '')
    return (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <div className="flex items-start gap-2.5">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-destructive/70" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-destructive/80 leading-relaxed break-words">{clean}</p>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs text-destructive/60 hover:text-destructive transition-colors cursor-pointer"
                        >
                            <RefreshCw size={11} />
                            <span>重试</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
