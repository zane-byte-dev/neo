/**
 * MindMap — render markmap from markdown with interactive controls.
 */
import React from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react'

const transformer = new Transformer()

interface Props { markdown: string }

export const MindMap: React.FC<Props> = ({ markdown }) => {
    const svgRef = React.useRef<SVGSVGElement>(null)
    const mmRef = React.useRef<Markmap | null>(null)

    React.useEffect(() => {
        if (!svgRef.current) return
        const { root } = transformer.transform(markdown || '# (empty)')
        if (!mmRef.current) {
            mmRef.current = Markmap.create(svgRef.current, {
                autoFit: true,
                duration: 300,
            }, root)
        } else {
            mmRef.current.setData(root)
            mmRef.current.fit()
        }
    }, [markdown])

    React.useEffect(() => () => {
        mmRef.current?.destroy()
        mmRef.current = null
    }, [])

    const handleFit = () => mmRef.current?.fit()

    const handleZoomIn = () => {
        if (!mmRef.current || !svgRef.current) return
        // Access the d3 svg selection and zoom behavior
        const mm = mmRef.current as Markmap & { svg?: unknown }
        try {
            // markmap-view exposes rescale(scale) method
            (mm as unknown as { rescale: (s: number) => void }).rescale(1.3)
        } catch {
            // fallback: just fit
            mm.fit()
        }
    }

    const handleZoomOut = () => {
        if (!mmRef.current) return
        const mm = mmRef.current as Markmap & { svg?: unknown }
        try {
            (mm as unknown as { rescale: (s: number) => void }).rescale(0.7)
        } catch {
            mm.fit()
        }
    }

    const handleReset = () => {
        if (!mmRef.current) return
        const { root } = transformer.transform(markdown || '# (empty)')
        mmRef.current.setData(root)
        mmRef.current.fit()
    }

    return (
        <div className="w-full h-full relative bg-bg-container rounded-lg overflow-hidden group">
            <svg ref={svgRef} className="w-full h-full" />
            {/* Floating control bar */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-bg-container/90 border border-border rounded-xl px-2 py-1.5 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                <button onClick={handleZoomIn} className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors" title="放大">
                    <ZoomIn size={14} className="text-text-secondary" />
                </button>
                <button onClick={handleZoomOut} className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors" title="缩小">
                    <ZoomOut size={14} className="text-text-secondary" />
                </button>
                <div className="w-px h-4 bg-border mx-0.5" />
                <button onClick={handleFit} className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors" title="适应窗口">
                    <Maximize2 size={14} className="text-text-secondary" />
                </button>
                <button onClick={handleReset} className="p-1.5 hover:bg-fill-secondary rounded-lg transition-colors" title="重置">
                    <RotateCcw size={14} className="text-text-secondary" />
                </button>
            </div>
        </div>
    )
}
