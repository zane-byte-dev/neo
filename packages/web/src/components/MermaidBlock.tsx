import React from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

export const MermaidBlock: React.FC<{ children: string }> = ({ children }) => {
    const [svg, setSvg] = React.useState<string>('')
    const [error, setError] = React.useState<string>('')
    const id = React.useId().replace(/:/g, '')

    React.useEffect(() => {
        let cancelled = false
        setError('')
        setSvg('')
        mermaid.render(`mermaid-${id}`, children.trim()).then(({ svg: rendered }) => {
            if (!cancelled) setSvg(DOMPurify.sanitize(rendered, { USE_PROFILES: { svg: true, svgFilters: true } }))
        }).catch((err: unknown) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        })
        return () => { cancelled = true }
    }, [children, id])

    if (error) {
        return (
            <div className="rounded-xl border border-border bg-fill-secondary/40 p-4 text-sm text-text-tertiary mb-4">
                <span className="font-medium text-warning">Mermaid error: </span>{error}
            </div>
        )
    }

    if (!svg) {
        return (
            <div className="rounded-xl border border-border bg-fill-secondary/40 p-4 text-sm text-text-tertiary mb-4 animate-pulse">
                Rendering diagram…
            </div>
        )
    }

    return (
        <div
            className="rounded-xl border border-border bg-fill-secondary/40 p-4 mb-4 overflow-x-auto flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    )
}
