import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { markdownComponents } from './markdownComponents'

export const MarkdownMathRenderer: React.FC<{ content: string }> = ({ content }) => (
    <div className="markdown-content max-w-none break-words">
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
        >
            {content}
        </ReactMarkdown>
    </div>
)
