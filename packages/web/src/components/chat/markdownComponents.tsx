import React from 'react'
import { CodeBlock, InlineCode } from '../CodeBlock'

const MermaidBlock = React.lazy(() => import('../MermaidBlock').then((mod) => ({ default: mod.MermaidBlock })))

export const markdownComponents: import('react-markdown').Components = {
    pre({ children }) {
        return <>{children}</>
    },
    code({ className, children, ...rest }) {
        const match = /language-(\w+)/.exec(className || '')
        const text = String(children).replace(/\n$/, '')

        if (match?.[1] === 'mermaid') {
            return (
                <React.Suspense
                    fallback={(
                        <div className="rounded-xl border border-border bg-fill-secondary/40 p-4 text-sm text-text-tertiary mb-4 animate-pulse">
                            Rendering diagram...
                        </div>
                    )}
                >
                    <MermaidBlock>{text}</MermaidBlock>
                </React.Suspense>
            )
        }

        if (match || text.includes('\n')) {
            return <CodeBlock language={match?.[1]}>{text}</CodeBlock>
        }

        return <InlineCode {...rest}>{children}</InlineCode>
    },
}
