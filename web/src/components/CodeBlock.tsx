import React from 'react'
import { Check, Copy, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/utils'

interface CodeBlockProps {
    language?: string
    children: string
}

/** Threshold for collapsing long code blocks — keeps initial view compact while allowing expansion */
const MAX_LINES_COLLAPSED = 30

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, children }) => {
    const [copied, setCopied] = React.useState(false)
    const [expanded, setExpanded] = React.useState(false)

    const lines = children.split('\n')
    const isLong = lines.length > MAX_LINES_COLLAPSED
    const displayCode = isLong && !expanded
        ? lines.slice(0, MAX_LINES_COLLAPSED).join('\n')
        : children

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(children)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            /* clipboard may not be available */
        }
    }

    return (
        <div className="group/code relative rounded-xl border border-border overflow-hidden mb-4">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-fill-secondary/80 border-b border-border text-xs">
                <span className="text-text-tertiary font-medium">
                    {language || 'text'}
                </span>
                <button
                    onClick={handleCopy}
                    className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-md transition-all duration-200 text-[11px] font-medium',
                        copied
                            ? 'text-success bg-success/10'
                            : 'text-text-tertiary hover:text-text-secondary hover:bg-fill'
                    )}
                >
                    {copied ? (
                        <><Check size={12} /> Copied</>
                    ) : (
                        <><Copy size={12} /> Copy</>
                    )}
                </button>
            </div>

            {/* Code content */}
            <pre className="!m-0 !rounded-none !border-none overflow-x-auto p-4 text-[13px] leading-[1.7] bg-fill-secondary/40">
                <code className={language ? `hljs language-${language}` : ''}>
                    {displayCode}
                </code>
            </pre>

            {/* Expand/collapse for long code */}
            {isLong && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-fill-secondary/60 border-t border-border text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {expanded ? (
                        <><ChevronUp size={12} /> Show less</>
                    ) : (
                        <><ChevronDown size={12} /> Show all {lines.length} lines</>
                    )}
                </button>
            )}
        </div>
    )
}

/**
 * Inline code component for react-markdown
 */
export const InlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <code className="bg-fill px-1.5 py-0.5 rounded-md text-[0.85em] font-mono border border-border-secondary">
        {children}
    </code>
)
