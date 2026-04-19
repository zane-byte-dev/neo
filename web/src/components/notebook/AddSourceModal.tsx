/**
 * AddSourceModal — NotebookLM-style modal for adding sources.
 * Supports: URL / YouTube, paste text, file upload (drag-drop + click).
 */
import React from 'react'
import { X, Upload, Link as LinkIcon, ClipboardPaste, Loader2 } from 'lucide-react'
import { notebookImportSource, uploadFiles } from '../../api'

type Tab = 'upload' | 'url' | 'text'

interface Props {
    notebook: string
    open: boolean
    onClose: () => void
    onImported: () => void
}

export const AddSourceModal: React.FC<Props> = ({ notebook, open, onClose, onImported }) => {
    const [tab, setTab] = React.useState<Tab>('upload')
    const [importing, setImporting] = React.useState(false)
    const [error, setError] = React.useState('')
    const [dragOver, setDragOver] = React.useState(false)

    // URL tab
    const [urlInput, setUrlInput] = React.useState('')
    // Text tab
    const [textTitle, setTextTitle] = React.useState('')
    const [textContent, setTextContent] = React.useState('')

    const reset = () => {
        setUrlInput('')
        setTextTitle('')
        setTextContent('')
        setError('')
        setImporting(false)
        setTab('upload')
    }

    const handleClose = () => {
        reset()
        onClose()
    }

    const handleImportUrl = async () => {
        if (!urlInput.trim() || importing) return
        setImporting(true); setError('')
        try {
            await notebookImportSource({ notebook, kind: 'url', url: urlInput.trim() })
            setUrlInput('')
            onImported()
            handleClose()
        } catch (e) {
            setError((e as Error).message)
        } finally { setImporting(false) }
    }

    const handleImportText = async () => {
        if (!textContent.trim() || importing) return
        setImporting(true); setError('')
        try {
            await notebookImportSource({ notebook, kind: 'text', title: textTitle.trim() || undefined, content: textContent })
            setTextTitle(''); setTextContent('')
            onImported()
            handleClose()
        } catch (e) {
            setError((e as Error).message)
        } finally { setImporting(false) }
    }

    const handleFiles = async (files: FileList | File[]) => {
        const fileArr = Array.from(files)
        if (!fileArr.length) return
        setImporting(true); setError('')
        try {
            const uploaded = await uploadFiles(fileArr)
            for (const f of uploaded) {
                if (f.type === 'document') {
                    await notebookImportSource({
                        notebook, kind: 'document',
                        filename: f.filename,
                        content: f.text,
                        mimeType: f.mimeType,
                    })
                }
            }
            onImported()
            handleClose()
        } catch (e) {
            setError((e as Error).message)
        } finally { setImporting(false) }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 animate-fade-in" onClick={handleClose}>
            <div
                className="bg-bg-container rounded-2xl shadow-2xl w-[520px] max-w-[92vw] max-h-[85vh] overflow-hidden animate-slide-up"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <h2 className="text-base font-semibold text-text">添加来源</h2>
                    <button onClick={handleClose} className="p-1.5 hover:bg-fill-secondary rounded-lg text-text-secondary transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Drag-drop zone */}
                <div className="px-5 pb-3">
                    <label
                        className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                            dragOver ? 'border-primary-mint bg-primary-mint/5' : 'border-border hover:border-primary-mint/50'
                        }`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                    >
                        <Upload size={28} className="mx-auto text-text-tertiary mb-2" />
                        <div className="text-sm font-medium text-text mb-1">拖放文件到此处</div>
                        <div className="text-xs text-text-tertiary">PDF、文档、Markdown、文本文件</div>
                        <input
                            type="file"
                            multiple
                            accept=".pdf,.docx,.doc,.md,.txt,.markdown"
                            className="hidden"
                            onChange={(e) => e.target.files && handleFiles(e.target.files)}
                        />
                    </label>
                </div>

                {/* Tab buttons */}
                <div className="px-5 pb-3 flex gap-2">
                    {([
                        ['upload', Upload, '上传文件'],
                        ['url', LinkIcon, '网站 / YouTube'],
                        ['text', ClipboardPaste, '复制的文字'],
                    ] as const).map(([k, Icon, label]) => (
                        <button
                            key={k}
                            onClick={() => { setTab(k); setError('') }}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-full border transition-colors ${
                                tab === k
                                    ? 'border-primary-mint/40 bg-primary-mint/10 text-primary-mint'
                                    : 'border-border hover:border-primary-mint/30 text-text-secondary hover:text-text'
                            }`}
                        >
                            <Icon size={13} /> {label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="px-5 pb-5">
                    {tab === 'upload' && (
                        <label className="block border border-border rounded-xl p-4 text-center cursor-pointer hover:bg-fill-secondary/40 transition-colors">
                            <div className="text-xs text-text-secondary">点击选择文件</div>
                            <input
                                type="file"
                                multiple
                                accept=".pdf,.docx,.doc,.md,.txt,.markdown"
                                className="hidden"
                                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                            />
                        </label>
                    )}

                    {tab === 'url' && (
                        <div className="space-y-2">
                            <input
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                placeholder="https://... 或 YouTube 链接"
                                className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleImportUrl() }}
                                autoFocus
                            />
                            <button
                                onClick={handleImportUrl}
                                disabled={importing || !urlInput.trim()}
                                className="w-full bg-primary-mint text-white text-sm font-medium py-2.5 rounded-xl disabled:opacity-50 hover:bg-primary-mint/90 transition-colors"
                            >
                                {importing ? <Loader2 size={14} className="animate-spin mx-auto" /> : '导入'}
                            </button>
                        </div>
                    )}

                    {tab === 'text' && (
                        <div className="space-y-2">
                            <input
                                value={textTitle}
                                onChange={(e) => setTextTitle(e.target.value)}
                                placeholder="标题（可选）"
                                className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30"
                                autoFocus
                            />
                            <textarea
                                value={textContent}
                                onChange={(e) => setTextContent(e.target.value)}
                                placeholder="粘贴文字内容..."
                                rows={5}
                                className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-mint/30 resize-none"
                            />
                            <button
                                onClick={handleImportText}
                                disabled={importing || !textContent.trim()}
                                className="w-full bg-primary-mint text-white text-sm font-medium py-2.5 rounded-xl disabled:opacity-50 hover:bg-primary-mint/90 transition-colors"
                            >
                                {importing ? <Loader2 size={14} className="animate-spin mx-auto" /> : '保存'}
                            </button>
                        </div>
                    )}

                    {importing && tab === 'upload' && (
                        <div className="mt-2 text-xs text-text-tertiary flex items-center gap-1 justify-center">
                            <Loader2 size={12} className="animate-spin" /> 解析上传文件中…
                        </div>
                    )}

                    {error && <p className="text-xs text-destructive mt-2">{error}</p>}
                </div>
            </div>
        </div>
    )
}
