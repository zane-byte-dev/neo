/**
 * MindMap — render markmap from markdown.
 */
import React from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'

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

    return (
        <div className="w-full h-full relative bg-bg-container rounded-lg overflow-hidden">
            <svg ref={svgRef} className="w-full h-full" />
        </div>
    )
}
