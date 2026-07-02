import React from 'react'
import { Check, Copy, ChevronDown, ChevronUp } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { cn } from '../lib/utils'

interface CodeBlockProps {
    language?: string
    children: string
}

/** Threshold for collapsing long code blocks — keeps initial view compact while allowing expansion */
const MAX_LINES_COLLAPSED = 30

const LANGUAGE_ALIASES: Record<string, string> = {
    cjs: 'javascript',
    html: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    md: 'markdown',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml',
    zsh: 'bash',
}

function registerLanguage(name: string, grammar: Parameters<typeof hljs.registerLanguage>[1]) {
    if (!hljs.getLanguage(name)) hljs.registerLanguage(name, grammar)
}

registerLanguage('bash', bash)
registerLanguage('css', css)
registerLanguage('javascript', javascript)
registerLanguage('json', json)
registerLanguage('markdown', markdown)
registerLanguage('python', python)
registerLanguage('typescript', typescript)
registerLanguage('xml', xml)
registerLanguage('yaml', yaml)

function normalizeLanguage(language: string | undefined): string | undefined {
    if (!language) return undefined
    const normalized = language.toLowerCase().replace(/^language-/, '')
    return LANGUAGE_ALIASES[normalized] ?? normalized
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, children }) => {
    const [copied, setCopied] = React.useState(false)
    const [expanded, setExpanded] = React.useState(false)

    const lines = children.split('\n')
    const isLong = lines.length > MAX_LINES_COLLAPSED
    const displayCode = isLong && !expanded
        ? lines.slice(0, MAX_LINES_COLLAPSED).join('\n')
        : children
    const normalizedLanguage = normalizeLanguage(language)
    const highlightedHtml = React.useMemo(() => {
        if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) return null
        try {
            return hljs.highlight(displayCode, { language: normalizedLanguage, ignoreIllegals: true }).value
        } catch {
            return null
        }
    }, [displayCode, normalizedLanguage])

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
                {highlightedHtml ? (
                    <code
                        className={`hljs language-${normalizedLanguage}`}
                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                    />
                ) : (
                    <code className={normalizedLanguage ? `hljs language-${normalizedLanguage}` : ''}>
                        {displayCode}
                    </code>
                )}
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
