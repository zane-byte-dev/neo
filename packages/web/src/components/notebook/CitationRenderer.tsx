/**
 * CitationRenderer — parses 【N】 tokens in markdown text and renders them
 * as clickable chips that show the source title on hover.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ParsedCitation } from '../../types'

export type CitedSource = ParsedCitation

interface Props {
    content: string
    sources?: CitedSource[]
    onCitationClick?: (source: CitedSource) => void
}

const CITATION_RE = /【\s*(\d+)(?:\s*[:：][^】]*)?\s*】/g

/**
 * Convert "【1】" to a placeholder `{{CITE:1}}` before markdown rendering,
 * then replace in the output via a custom text transform component.
 */
export const CitationRenderer: React.FC<Props> = ({ content, sources = [], onCitationClick }) => {
    // Replace citations with inline HTML-safe tokens that survive markdown
    const placeholders: Array<{ n: number }> = []
    const transformed = content.replace(CITATION_RE, (_m, num) => {
        const n = Number(num)
        placeholders.push({ n })
        return `[[CITE_${n}_${placeholders.length - 1}]]`
    })

    // Wrap text nodes to detect and replace placeholders
    const renderText = (text: string): React.ReactNode => {
        const parts: React.ReactNode[] = []
        const re = /\[\[CITE_(\d+)_(\d+)\]\]/g
        let last = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push(text.slice(last, m.index))
            const n = Number(m[1])
            const src = sources.find((s) => s.n === n)
            parts.push(
                <button
                    key={`${m.index}-${n}`}
                    type="button"
                    onClick={() => src && onCitationClick?.(src)}
                    title={src?.title ?? `Source ${n}`}
                    className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded text-[10px] font-semibold bg-primary-mint/15 text-primary-mint hover:bg-primary-mint/25 transition-colors align-baseline"
                >{n}</button>,
            )
            last = re.lastIndex
        }
        if (last < text.length) parts.push(text.slice(last))
        return <>{parts}</>
    }

    return (
        <div className="markdown-content text-sm leading-relaxed">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children }) => <p>{React.Children.map(children, (c) => typeof c === 'string' ? renderText(c) : c)}</p>,
                    li: ({ children }) => <li>{React.Children.map(children, (c) => typeof c === 'string' ? renderText(c) : c)}</li>,
                }}
            >
                {transformed}
            </ReactMarkdown>
        </div>
    )
}
