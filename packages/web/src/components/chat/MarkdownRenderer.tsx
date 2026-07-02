import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdownComponents'

export const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none break-words">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
        >
            {content}
        </ReactMarkdown>
    </div>
)
