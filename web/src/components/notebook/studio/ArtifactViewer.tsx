import React from 'react'
import { Download, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Artifact } from '../../../types'
import { MindMap } from '../MindMap'
import { AudioOverview, type AudioLine } from '../AudioOverview'

// ── Markdown → HTML export utilities ────────────────────────────────────────

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

function applyInlineFormatting(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
}

function markdownToSimpleHtml(md: string): string {
    const escaped = escapeHtml(md)
    const lines = escaped.split('\n')
    const result: string[] = []
    let inList = false

    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('### ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h3>${trimmed.slice(4)}</h3>`)
        } else if (trimmed.startsWith('## ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h2>${trimmed.slice(3)}</h2>`)
        } else if (trimmed.startsWith('# ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<h1>${trimmed.slice(2)}</h1>`)
        } else if (trimmed.startsWith('- ')) {
            if (!inList) { result.push('<ul>'); inList = true }
            result.push(`<li>${applyInlineFormatting(trimmed.slice(2))}</li>`)
        } else if (trimmed.startsWith('&gt; ')) {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<blockquote>${applyInlineFormatting(trimmed.slice(5))}</blockquote>`)
        } else if (trimmed === '') {
            if (inList) { result.push('</ul>'); inList = false }
            result.push('')
        } else {
            if (inList) { result.push('</ul>'); inList = false }
            result.push(`<p>${applyInlineFormatting(trimmed)}</p>`)
        }
    }
    if (inList) result.push('</ul>')
    return result.join('\n')
}

// ── ArtifactViewer component ────────────────────────────────────────────────

export const ArtifactViewer: React.FC<{
    artifact: Artifact
    onBack: () => void
    onRegenerate?: (type: 'audio' | 'mindmap' | 'report') => void
}> = ({ artifact, onBack, onRegenerate }) => {
    const markdown = typeof artifact.data.markdown === 'string' ? artifact.data.markdown : ''
    const script = Array.isArray(artifact.data.script) ? (artifact.data.script as AudioLine[]) : []

    const download = (format: 'md' | 'json' | 'txt' | 'html') => {
        let content = ''
        let filename = artifact.title
        let mime = 'text/plain'

        if (artifact.type === 'audio') {
            if (format === 'json') {
                content = JSON.stringify(script, null, 2)
                filename += '.json'
                mime = 'application/json'
            } else {
                content = script.map((l) => `[${l.speaker}] ${l.text}`).join('\n\n')
                filename += '.txt'
            }
        } else if (format === 'html') {
            const htmlContent = markdownToSimpleHtml(markdown)
            const safeTitle = escapeHtml(artifact.title)
            const safeType = escapeHtml(artifact.subtype ?? artifact.type)
            content = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1a1a1a}h1,h2,h3{margin-top:1.5em}blockquote{border-left:3px solid #34d399;padding-left:1em;color:#555}code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:0.9em}pre{background:#f5f5f5;padding:1em;border-radius:3px;overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f9f9f9}.meta{color:#888;font-size:0.85em;margin-bottom:2em}ul{padding-left:1.5em}</style>
</head>
<body>
<div class="meta">来源：Neo Notebook · ${safeType} · ${new Date(artifact.createdAt).toLocaleString('zh-CN')}</div>
${htmlContent}
</body></html>`
            filename += '.html'
            mime = 'text/html'
        } else {
            const header = `---\ntitle: ${artifact.title}\ntype: ${artifact.type}${artifact.subtype ? `\nsubtype: ${artifact.subtype}` : ''}\ndate: ${new Date(artifact.createdAt).toISOString()}\n---\n\n`
            content = header + markdown
            filename += '.md'
            mime = 'text/markdown'
        }

        const blob = new Blob([content], { type: mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename; a.click()
        URL.revokeObjectURL(url)
    }

    const [exportOpen, setExportOpen] = React.useState(false)
    const exportRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!exportOpen) return
        const handler = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [exportOpen])

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
                <button onClick={onBack} className="text-xs px-2.5 py-1.5 bg-fill-secondary rounded-lg hover:bg-fill">← 返回</button>
                <span className="text-sm font-medium flex-1 truncate">{artifact.title}</span>
                {onRegenerate && (
                    <button
                        onClick={() => onRegenerate(artifact.type)}
                        className="text-xs text-text-secondary hover:text-primary-mint p-1.5 hover:bg-fill-secondary rounded-lg flex items-center gap-1"
                        title="重新生成"
                    >
                        <RefreshCw size={13} />
                        <span className="hidden sm:inline">重新生成</span>
                    </button>
                )}
                <div className="relative" ref={exportRef}>
                    <button
                        onClick={() => setExportOpen(!exportOpen)}
                        className="text-xs text-text-secondary hover:text-text p-1.5 hover:bg-fill-secondary rounded-lg flex items-center gap-1"
                    >
                        <Download size={13} />
                        <span className="hidden sm:inline">导出</span>
                    </button>
                    {exportOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-bg-container border border-border rounded-xl py-1 shadow-lg z-50 min-w-[140px] animate-slide-up">
                            <button onClick={() => { download('md'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                📝 Markdown
                            </button>
                            <button onClick={() => { download('html'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                🌐 HTML
                            </button>
                            {artifact.type === 'audio' && (
                                <>
                                    <button onClick={() => { download('json'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                        📋 JSON (脚本)
                                    </button>
                                    <button onClick={() => { download('txt'); setExportOpen(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text hover:bg-fill-secondary transition-colors">
                                        📄 TXT (对话稿)
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                {artifact.type === 'mindmap' && <MindMap markdown={markdown} />}
                {artifact.type === 'audio' && <AudioOverview script={script} title={artifact.title} />}
                {artifact.type === 'report' && (
                    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 markdown-content text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    )
}
