/**
 * NovelEditor — Novel/Tiptap-based rich text editor
 *
 * Content is stored/emitted as Markdown (via tiptap-markdown) to keep the
 * backend API unchanged.  The editor key must be managed by the parent
 * (e.g. key={note?.id ?? 'new'}) so React remounts when switching notes.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Node as TiptapNode } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
    EditorRoot,
    EditorContent,
    EditorBubble,
    EditorBubbleItem,
    EditorCommand,
    EditorCommandItem,
    EditorCommandList,
    EditorCommandEmpty,
    StarterKit,
    HighlightExtension,
    AIHighlight,
    Placeholder,
    type EditorInstance,
    type SuggestionItem,
    handleCommandNavigation,
    createSuggestionItems,
    renderItems,
    Command,
    useEditor,
    getPrevText,
    addAIHighlight,
    removeAIHighlight,
} from 'novel'
import { Markdown } from 'tiptap-markdown'
import {
    Bold, Italic, Strikethrough, Code,
    Heading1, Heading2, Heading3,
    List, ListOrdered, Quote, Minus, Code2, Type,
    Sparkles, Wand2, ArrowUpRight, ArrowDownToLine, Scissors, CheckSquare,
    Check, X as XIcon, MessageSquarePlus, Trash2, CircleDot, Brain, FileText,
} from 'lucide-react'
import { cn } from '../lib/utils'
import type { NotebookAnnotation } from '../types'
import { MindMap } from './notebook/MindMap'

const ANNOTATION_CONTEXT_LENGTH = 200
const ANNOTATION_HIGHLIGHT_COLOR = 'neo-annotation'

export type GeneratedResourceType = 'mindmap' | 'report'

export interface GeneratedResourceBlockData {
    type: GeneratedResourceType
    title: string
    body: string
}

type GeneratedResourceStatus = 'loading' | 'ready' | 'error'

interface GeneratedResourceBlockAttrs extends GeneratedResourceBlockData {
    id: string
    status: GeneratedResourceStatus
}

const RESOURCE_LABEL: Record<GeneratedResourceType, string> = {
    mindmap: '思维导图',
    report: '报告',
}

const GeneratedResourceBlockPreview: React.FC<{ attrs: GeneratedResourceBlockAttrs }> = ({ attrs }) => {
    const body = attrs.body || generatedResourceFallback(attrs.status)
    const isMindMap = attrs.type === 'mindmap' && attrs.status === 'ready' && body.trim().length > 0

    return (
        <details
            data-neo-generated-block=""
            data-id={attrs.id}
            data-type={attrs.type}
            data-status={attrs.status}
            className="neo-generated-block"
            open
        >
            <summary className="neo-generated-block-summary">{generatedResourceSummary(attrs)}</summary>
            <div
                data-neo-generated-body=""
                className={cn(
                    'neo-generated-block-body',
                    isMindMap && 'neo-generated-block-body-mindmap',
                )}
            >
                {isMindMap ? (
                    <div className="neo-generated-block-mindmap">
                        <MindMap markdown={body} />
                    </div>
                ) : (
                    <pre className="neo-generated-block-body-text">{body}</pre>
                )}
            </div>
        </details>
    )
}

const GeneratedResourceBlock = TiptapNode.create({
    name: 'generatedResourceBlock',
    group: 'block',
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            id: { default: '' },
            type: { default: 'report' },
            title: { default: '生成模块' },
            body: { default: '' },
            status: { default: 'ready' },
        }
    },

    parseHTML() {
        return [{
            tag: 'details[data-neo-generated-block]',
            getAttrs: (element: HTMLElement | string) => {
                if (!(element instanceof HTMLElement)) return false
                const type = element.getAttribute('data-type') === 'mindmap' ? 'mindmap' : 'report'
                const title = element.querySelector('summary')?.textContent?.trim() || RESOURCE_LABEL[type]
                const body = element.querySelector('[data-neo-generated-body]')?.textContent ?? ''
                const status = element.getAttribute('data-status') === 'error' ? 'error' : 'ready'
                return {
                    id: element.getAttribute('data-id') || `resource-${Date.now()}`,
                    type,
                    title: title.replace(/^思维导图：|^报告：/, ''),
                    body,
                    status,
                }
            },
        }]
    },

    renderHTML({ node }: { node: ProseMirrorNode; HTMLAttributes: Record<string, any> }) {
        const attrs = normalizeGeneratedResourceAttrs(node.attrs as Partial<GeneratedResourceBlockAttrs>)
        return [
            'details',
            {
                'data-neo-generated-block': '',
                'data-id': attrs.id,
                'data-type': attrs.type,
                'data-status': attrs.status,
                class: 'neo-generated-block',
                open: '',
            },
            ['summary', { class: 'neo-generated-block-summary' }, generatedResourceSummary(attrs)],
            ['pre', { 'data-neo-generated-body': '', class: 'neo-generated-block-body' }, attrs.body || generatedResourceFallback(attrs.status)],
        ]
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: GeneratedResourceBlockAttrs }) {
                    state.write(serializeGeneratedResourceBlock(normalizeGeneratedResourceAttrs(node.attrs)))
                    state.closeBlock(node)
                },
                parse: {},
            },
        }
    },

    addNodeView() {
        return ({ node }: { node: ProseMirrorNode }) => {
            const dom = document.createElement('div')
            dom.className = 'neo-generated-block-node'
            dom.setAttribute('contenteditable', 'false')

            const root = createRoot(dom)
            const render = (currentNode: ProseMirrorNode) => {
                root.render(
                    <GeneratedResourceBlockPreview
                        attrs={normalizeGeneratedResourceAttrs(currentNode.attrs as Partial<GeneratedResourceBlockAttrs>)}
                    />,
                )
            }

            render(node)

            return {
                dom,
                update(updatedNode: ProseMirrorNode) {
                    if (updatedNode.type !== node.type) return false
                    render(updatedNode)
                    return true
                },
                ignoreMutation() {
                    return true
                },
                destroy() {
                    root.unmount()
                },
            }
        }
    },
})

function normalizeGeneratedResourceAttrs(attrs: Partial<GeneratedResourceBlockAttrs>): GeneratedResourceBlockAttrs {
    const type: GeneratedResourceType = attrs.type === 'mindmap' ? 'mindmap' : 'report'
    const status: GeneratedResourceStatus = attrs.status === 'loading' || attrs.status === 'error' ? attrs.status : 'ready'
    return {
        id: attrs.id || `resource-${Date.now()}`,
        type,
        title: attrs.title || RESOURCE_LABEL[type],
        body: attrs.body || '',
        status,
    }
}

function generatedResourceSummary(attrs: GeneratedResourceBlockAttrs): string {
    if (attrs.status === 'loading') return `正在生成${RESOURCE_LABEL[attrs.type]}...`
    if (attrs.status === 'error') return `${RESOURCE_LABEL[attrs.type]}生成失败`
    const title = attrs.title.trim()
    if (title.startsWith(`${RESOURCE_LABEL[attrs.type]}：`) || title.startsWith(`${RESOURCE_LABEL[attrs.type]}:`)) {
        return title
    }
    return `${RESOURCE_LABEL[attrs.type]}：${title}`
}

function generatedResourceFallback(status: GeneratedResourceStatus): string {
    return status === 'loading' ? '请稍候...' : '暂无内容'
}

function serializeGeneratedResourceBlock(attrs: GeneratedResourceBlockAttrs): string {
    const status = attrs.status === 'loading' ? 'ready' : attrs.status
    return [
        `<details data-neo-generated-block data-id="${escapeHtml(attrs.id)}" data-type="${attrs.type}" data-status="${status}" open>`,
        `<summary>${escapeHtml(generatedResourceSummary({ ...attrs, status }))}</summary>`,
        '',
        `<pre data-neo-generated-body>${escapeHtml(attrs.body || generatedResourceFallback(status))}</pre>`,
        '</details>',
    ].join('\n')
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// ─── AI completion helper ─────────────────────────────────────────────────────

type AICommand = 'continue' | 'improve' | 'shorter' | 'longer' | 'fix'

async function fetchAICompletion(prompt: string, command: AICommand): Promise<string> {
    const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, command }),
    })
    if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
    return res.text()
}

// ─── AI pending state & context ──────────────────────────────────────────────

interface AIPendingState {
    /** Start position of AI-inserted text in the doc */
    from: number
    /** End position of AI-inserted text in the doc */
    to: number
    /** Original text that was replaced (empty for insert-only commands) */
    originalText: string
    /** Human-readable label shown in the confirm bar */
    label: string
}

const AIStateContext = React.createContext<{
    pending: AIPendingState | null
    setPending: React.Dispatch<React.SetStateAction<AIPendingState | null>>
} | null>(null)

// ─── Slash-command suggestion items ──────────────────────────────────────────

const BASE_SUGGESTION_ITEMS: SuggestionItem[] = createSuggestionItems([
    {
        title: '正文',
        description: '普通段落文本',
        searchTerms: ['p', 'paragraph', 'text', '正文', '段落'],
        icon: <Type size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
        title: '标题 1',
        description: '大号一级标题',
        searchTerms: ['h1', 'heading1', '标题'],
        icon: <Heading1 size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
    },
    {
        title: '标题 2',
        description: '中号二级标题',
        searchTerms: ['h2', 'heading2', '标题'],
        icon: <Heading2 size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
    },
    {
        title: '标题 3',
        description: '小号三级标题',
        searchTerms: ['h3', 'heading3', '标题'],
        icon: <Heading3 size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
    },
    {
        title: '无序列表',
        description: '项目符号列表',
        searchTerms: ['ul', 'bullet', 'list', '列表', '无序'],
        icon: <List size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
        title: '有序列表',
        description: '数字编号列表',
        searchTerms: ['ol', 'ordered', 'number', '列表', '有序'],
        icon: <ListOrdered size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
        title: '引用',
        description: '引用块',
        searchTerms: ['quote', 'blockquote', '引用'],
        icon: <Quote size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setBlockquote().run(),
    },
    {
        title: '代码块',
        description: '等宽代码块',
        searchTerms: ['code', 'codeblock', '代码'],
        icon: <Code2 size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
        title: '分割线',
        description: '水平分割线',
        searchTerms: ['hr', 'divider', 'rule', '分割', '分隔'],
        icon: <Minus size={16} />,
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
])

type GenerateInlineResource = (type: GeneratedResourceType) => Promise<GeneratedResourceBlockData | null>

function createGeneratedResourceItems(onGenerateInlineResource?: GenerateInlineResource): SuggestionItem[] {
    if (!onGenerateInlineResource) return []
    return createSuggestionItems([
        {
            title: '生成思维导图',
            description: '基于当前文章插入可折叠导图模块',
            searchTerms: ['mindmap', 'map', '导图', '思维导图'],
            icon: <Brain size={16} />,
            command: ({ editor, range }) => insertGeneratedResourceBlock(editor, range, 'mindmap', onGenerateInlineResource),
        },
        {
            title: '生成报告',
            description: '基于当前文章插入可折叠报告模块',
            searchTerms: ['report', 'briefing', '报告', '总结'],
            icon: <FileText size={16} />,
            command: ({ editor, range }) => insertGeneratedResourceBlock(editor, range, 'report', onGenerateInlineResource),
        },
    ])
}

function insertGeneratedResourceBlock(
    editor: EditorInstance,
    range: { from: number; to: number },
    type: GeneratedResourceType,
    onGenerateInlineResource: GenerateInlineResource,
): void {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const loadingAttrs: GeneratedResourceBlockAttrs = {
        id,
        type,
        title: RESOURCE_LABEL[type],
        body: '请稍候...',
        status: 'loading',
    }
    editor.chain().focus().deleteRange(range).insertContent({ type: 'generatedResourceBlock', attrs: loadingAttrs }).run()

    void onGenerateInlineResource(type)
        .then((result) => {
            replaceGeneratedResourceBlock(editor, id, result
                ? { id, type: result.type, title: result.title, body: result.body, status: 'ready' }
                : { id, type, title: RESOURCE_LABEL[type], body: '没有生成可插入内容。', status: 'error' })
        })
        .catch(() => {
            replaceGeneratedResourceBlock(editor, id, {
                id,
                type,
                title: RESOURCE_LABEL[type],
                body: '生成失败，请稍后重试。',
                status: 'error',
            })
        })
}

function replaceGeneratedResourceBlock(editor: EditorInstance, id: string, attrs: GeneratedResourceBlockAttrs): void {
    const nodeType = editor.schema.nodes.generatedResourceBlock
    if (!nodeType) return

    const found = findGeneratedResourceBlock(editor, id)
    if (!found) return

    const transaction = editor.state.tr.replaceWith(found.pos, found.pos + found.size, nodeType.create(attrs))
    editor.view.dispatch(transaction)
}

function findGeneratedResourceBlock(editor: EditorInstance, id: string): { pos: number; size: number } | null {
    let result: { pos: number; size: number } | null = null
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'generatedResourceBlock' && node.attrs.id === id) {
            result = { pos, size: node.nodeSize }
            return false
        }
        return true
    })
    return result
}

// ─── Bubble menu button ───────────────────────────────────────────────────────

interface BubbleButtonProps {
    mark: string
    icon: React.ReactNode
    title: string
    onSelect: (editor: EditorInstance) => void
}

const BubbleButton: React.FC<BubbleButtonProps> = ({ mark, icon, title, onSelect }) => {
    const { editor } = useEditor()
    return (
        <EditorBubbleItem onSelect={onSelect} className="p-0">
            <button
                title={title}
                className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-fill hover:text-text transition-colors',
                    editor?.isActive(mark) && 'bg-fill text-primary-mint'
                )}
            >
                {icon}
            </button>
        </EditorBubbleItem>
    )
}

interface SelectionAnnotation {
    quote: string
    anchor: {
        startOffset: number
        endOffset: number
        beforeText?: string
        afterText?: string
    }
}

type AnnotationSelectionLike = {
    quote?: string
    anchor?: {
        startOffset?: number
        endOffset?: number
    }
}

export interface NovelEditorHandle {
    removeAnnotationMark: (selection: AnnotationSelectionLike) => void
}

interface AnnotationBubbleButtonProps {
    onAnnotateSelection?: (selection: SelectionAnnotation) => void
}

const AnnotationBubbleButton: React.FC<AnnotationBubbleButtonProps> = ({ onAnnotateSelection }) => {
    const handleSelect = (ed: EditorInstance) => {
        const { from, to } = ed.state.selection
        if (from === to) return
        const quote = ed.state.doc.textBetween(from, to, ' ').trim()
        if (!quote) return
        const beforeText = ed.state.doc.textBetween(Math.max(0, from - ANNOTATION_CONTEXT_LENGTH), from, ' ').trim()
        const afterText = ed.state.doc.textBetween(to, Math.min(ed.state.doc.content.size, to + ANNOTATION_CONTEXT_LENGTH), ' ').trim()
        ed.chain().focus().setHighlight({ color: ANNOTATION_HIGHLIGHT_COLOR }).run()
        onAnnotateSelection?.({
            quote,
            anchor: { startOffset: from, endOffset: to, beforeText, afterText },
        })
    }

    return (
        <EditorBubbleItem onSelect={handleSelect} className="p-0">
            <button
                title="添加批注"
                disabled={!onAnnotateSelection}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-fill hover:text-primary-mint transition-colors disabled:opacity-40"
            >
                <MessageSquarePlus size={13} />
            </button>
        </EditorBubbleItem>
    )
}

// ─── AI bubble button ─────────────────────────────────────────────────────────

interface AIBubbleButtonProps {
    command: AICommand
    icon: React.ReactNode
    title: string
    label: string
}

const AIBubbleButton: React.FC<AIBubbleButtonProps> = ({ command, icon, title, label }) => {
    const ctx = React.useContext(AIStateContext)
    const [loading, setLoading] = React.useState(false)

    const handleSelect = async (ed: EditorInstance) => {
        if (loading || ctx?.pending) return
        const { from, to } = ed.state.selection
        const selectedText = ed.state.doc.textBetween(from, to, '\n')
        const contextText = selectedText || getPrevText(ed, 5000)
        if (!contextText.trim()) return

        setLoading(true)
        try {
            const result = await fetchAICompletion(contextText, command)
            if (!result.trim()) return

            if (selectedText) {
                // Replace mode: delete selection, insert AI text, record original
                ed.chain().focus().deleteSelection().run()
                const insertFrom = from
                ed.chain().focus().insertContentAt(insertFrom, result).run()
                addAIHighlight(ed)
                ctx?.setPending({ from: insertFrom, to: insertFrom + result.length, originalText: selectedText, label })
            } else {
                // Insert mode: append after cursor
                const insertFrom = to
                ed.chain().focus().insertContentAt(insertFrom, result).run()
                addAIHighlight(ed)
                ctx?.setPending({ from: insertFrom, to: insertFrom + result.length, originalText: '', label })
            }
        } catch {
            // silently ignore
        } finally {
            setLoading(false)
        }
    }

    return (
        <EditorBubbleItem onSelect={handleSelect} className="p-0">
            <button
                title={title}
                disabled={loading || !!ctx?.pending}
                className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
                    loading
                        ? 'text-primary-mint animate-pulse cursor-wait'
                        : ctx?.pending
                        ? 'text-text-quaternary cursor-not-allowed'
                        : 'text-text-secondary hover:bg-fill hover:text-primary-mint'
                )}
            >
                {icon}
            </button>
        </EditorBubbleItem>
    )
}

// ─── AI confirm bar ───────────────────────────────────────────────────────────

interface AIConfirmBarProps {
    pending: AIPendingState
    onAccept: () => void
    onReject: () => void
}

const AIConfirmBar: React.FC<AIConfirmBarProps> = ({ pending, onAccept, onReject }) => {
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onAccept() }
            else if (e.key === 'Escape') { e.preventDefault(); onReject() }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [onAccept, onReject])

    return (
        <div className="flex justify-center pb-3 pt-1 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-1.5 bg-bg-container border border-border rounded-xl shadow-float px-2.5 py-1.5 animate-slide-up">
                <Sparkles size={13} className="text-primary-mint shrink-0" />
                <span className="text-[12px] text-text-secondary font-medium pr-1">{pending.label}</span>
                <div className="w-px h-3.5 bg-border shrink-0" />
                <button
                    onClick={onAccept}
                    className="flex items-center gap-1 text-[12px] font-medium text-primary-mint hover:bg-fill px-2 py-1 rounded-lg transition-colors"
                >
                    <Check size={12} />
                    <span>接受</span>
                </button>
                <button
                    onClick={onReject}
                    className="flex items-center gap-1 text-[12px] font-medium text-text-secondary hover:bg-fill px-2 py-1 rounded-lg transition-colors"
                >
                    <XIcon size={12} />
                    <span>撤回</span>
                </button>
                <span className="text-[11px] text-text-quaternary pl-1 hidden sm:inline">↵ 接受 · Esc 撤回</span>
            </div>
        </div>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NovelEditorProps {
    /** Initial Markdown content */
    initialContent: string
    placeholder?: string
    /** Called on every change with the latest Markdown string */
    onChange?: (markdown: string) => void
    onAnnotateSelection?: (selection: SelectionAnnotation) => void
    annotations?: NotebookAnnotation[]
    onAnnotationJump?: (annotation: NotebookAnnotation) => void
    onAnnotationToggleStatus?: (annotation: NotebookAnnotation) => void
    onAnnotationDelete?: (annotation: NotebookAnnotation) => void
    onGenerateInlineResource?: GenerateInlineResource
    focusRange?: { startOffset: number; endOffset: number; requestId: number } | null
    className?: string
}

export const NovelEditor = React.forwardRef<NovelEditorHandle, NovelEditorProps>(function NovelEditor({
    initialContent,
    placeholder = '开始写作…',
    onChange,
    onAnnotateSelection,
    annotations = [],
    onAnnotationJump,
    onAnnotationToggleStatus,
    onAnnotationDelete,
    onGenerateInlineResource,
    focusRange,
    className,
}, ref) {
    const [pending, setPending] = React.useState<AIPendingState | null>(null)
    const [annotationPopup, setAnnotationPopup] = React.useState<{ annotation: NotebookAnnotation; left: number; top: number } | null>(null)
    const editorRef = React.useRef<EditorInstance | null>(null)
    const annotationPopupTimerRef = React.useRef<number | null>(null)

    const clearAnnotationPopupTimer = React.useCallback(() => {
        if (annotationPopupTimerRef.current) {
            window.clearTimeout(annotationPopupTimerRef.current)
            annotationPopupTimerRef.current = null
        }
    }, [])

    const scheduleAnnotationPopupHide = React.useCallback(() => {
        clearAnnotationPopupTimer()
        annotationPopupTimerRef.current = window.setTimeout(() => setAnnotationPopup(null), 140)
    }, [clearAnnotationPopupTimer])

    const removeAnnotationMark = React.useCallback((selection: AnnotationSelectionLike) => {
        const ed = editorRef.current
        if (!ed) return

        let from = typeof selection.anchor?.startOffset === 'number' ? selection.anchor.startOffset : null
        let to = typeof selection.anchor?.endOffset === 'number' ? selection.anchor.endOffset : null
        const docMax = ed.state.doc.content.size

        if (from !== null && to !== null && from < to) {
            from = Math.max(1, Math.min(from, docMax))
            to = Math.max(from, Math.min(to, docMax))
            ed.chain().focus().setTextSelection({ from, to }).unsetHighlight().run()
            return
        }

        const quote = selection.quote?.trim()
        if (!quote) return
        let found: { from: number; to: number } | null = null
        ed.state.doc.descendants((node, pos) => {
            if (found || !node.isText) return false
            const text = node.text ?? ''
            const index = text.indexOf(quote)
            if (index >= 0) found = { from: pos + index, to: pos + index + quote.length }
            return !found
        })
        if (found) ed.chain().focus().setTextSelection(found).unsetHighlight().run()
    }, [])

    React.useImperativeHandle(ref, () => ({ removeAnnotationMark }), [removeAnnotationMark])

    const handleAccept = React.useCallback(() => {
        if (editorRef.current) removeAIHighlight(editorRef.current)
        setPending(null)
    }, [])

    const handleReject = React.useCallback(() => {
        const ed = editorRef.current
        if (ed && pending) {
            ed.chain().focus().deleteRange({ from: pending.from, to: pending.to }).run()
            if (pending.originalText) {
                ed.chain().focus().insertContentAt(pending.from, pending.originalText).run()
            }
            removeAIHighlight(ed)
        }
        setPending(null)
    }, [pending])

    // Build extensions fresh when placeholder changes (remount via parent key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suggestionItems = React.useMemo(
        () => [...BASE_SUGGESTION_ITEMS, ...createGeneratedResourceItems(onGenerateInlineResource)],
        [onGenerateInlineResource],
    )

    const extensions = React.useMemo((): any[] => [
        StarterKit.configure({
            heading: { levels: [1, 2, 3] },
        }),
        GeneratedResourceBlock,
        AIHighlight.configure({ HTMLAttributes: { class: 'ai-highlight' } }),
        HighlightExtension.configure({ multicolor: true }),
        Markdown.configure({
            html: true,
            transformPastedText: true,
            transformCopiedText: true,
        }),
        Placeholder.configure({ placeholder }),
        Command.configure({
            suggestion: {
                items: ({ query }: { query: string }) =>
                    query
                        ? suggestionItems.filter(
                              (item) =>
                                  item.title.toLowerCase().includes(query.toLowerCase()) ||
                                  item.description?.toLowerCase().includes(query.toLowerCase()) ||
                                  item.searchTerms?.some((t) => t.includes(query.toLowerCase()))
                          )
                        : suggestionItems,
                render: renderItems,
            },
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [placeholder, suggestionItems])

    React.useEffect(() => {
        const ed = editorRef.current
        if (!ed || !focusRange) return
        const max = ed.state.doc.content.size
        const from = Math.max(1, Math.min(focusRange.startOffset, max))
        const to = Math.max(from, Math.min(focusRange.endOffset, max))
        ed.chain().focus().setTextSelection({ from, to }).run()
        const dom = ed.view.domAtPos(from).node
        const el = dom instanceof Element ? dom : dom.parentElement
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, [focusRange])

    const findAnnotationForText = React.useCallback((text: string): NotebookAnnotation | null => {
        const normalizedText = normalizeAnnotationText(text)
        if (!normalizedText) return null
        return [...annotations]
            .sort((a, b) => b.quote.length - a.quote.length)
            .find((annotation) => {
                const quote = normalizeAnnotationText(annotation.quote)
                return !!quote && (normalizedText.includes(quote) || quote.includes(normalizedText))
            }) ?? null
    }, [annotations])

    React.useEffect(() => {
        const root = editorRef.current?.view.dom
        if (!root || annotations.length === 0) return

        const handleMouseOver = (event: MouseEvent) => {
            const target = event.target instanceof Element
                ? event.target.closest(`mark[data-color="${ANNOTATION_HIGHLIGHT_COLOR}"]`) as HTMLElement | null
                : null
            if (!target || !root.contains(target)) return
            const annotation = findAnnotationForText(target.textContent ?? '')
            if (!annotation) return
            const rect = target.getBoundingClientRect()
            clearAnnotationPopupTimer()
            setAnnotationPopup({
                annotation,
                left: Math.max(144, Math.min(window.innerWidth - 144, rect.left + rect.width / 2)),
                top: Math.min(window.innerHeight - 150, rect.bottom + 8),
            })
        }

        const handleMouseOut = (event: MouseEvent) => {
            const target = event.target instanceof Element
                ? event.target.closest(`mark[data-color="${ANNOTATION_HIGHLIGHT_COLOR}"]`)
                : null
            if (target && root.contains(target)) scheduleAnnotationPopupHide()
        }

        root.addEventListener('mouseover', handleMouseOver)
        root.addEventListener('mouseout', handleMouseOut)
        return () => {
            root.removeEventListener('mouseover', handleMouseOver)
            root.removeEventListener('mouseout', handleMouseOut)
        }
    }, [annotations.length, clearAnnotationPopupTimer, findAnnotationForText, scheduleAnnotationPopupHide])

    React.useEffect(() => () => clearAnnotationPopupTimer(), [clearAnnotationPopupTimer])

    return (
        <AIStateContext.Provider value={{ pending, setPending }}>
            <div className={cn('flex flex-col', className)}>
                <EditorRoot>
                    <EditorContent
                        className="w-full"
                        extensions={extensions}
                        editorProps={{
                            handleDOMEvents: {
                                keydown: (_view, event) => handleCommandNavigation(event),
                            },
                            attributes: {
                                class: 'novel-editor-body outline-none',
                            },
                        }}
                        onCreate={({ editor }) => {
                            editorRef.current = editor
                            if (initialContent) {
                                editor.commands.setContent(initialContent)
                            }
                        }}
                        onUpdate={({ editor }) => {
                            const md = (editor.storage.markdown as { getMarkdown(): string }).getMarkdown()
                            onChange?.(md)
                        }}
                    >
                        {/* ── Slash command popup ─────────────────────────────────── */}
                        <EditorCommand className="novel-slash-menu z-50 h-auto max-h-72 w-64 overflow-y-auto rounded-lg border border-border shadow-float py-1">
                            <EditorCommandEmpty className="px-3 py-2 text-xs text-text-tertiary">
                                无匹配命令
                            </EditorCommandEmpty>
                            <EditorCommandList>
                                {suggestionItems.map((item, i) => (
                                    <EditorCommandItem
                                        key={`${item.title}-${i}`}
                                        value={item.title}
                                        onCommand={(val) => item.command?.(val)}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-fill-secondary aria-selected:bg-fill cursor-pointer transition-colors"
                                    >
                                        <span className="w-7 h-7 flex items-center justify-center rounded-md bg-fill text-text-secondary shrink-0">
                                            {item.icon}
                                        </span>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[13px] font-medium text-text leading-tight">
                                                {item.title}
                                            </span>
                                            {item.description && (
                                                <span className="text-[11px] text-text-tertiary truncate">
                                                    {item.description}
                                                </span>
                                            )}
                                        </div>
                                    </EditorCommandItem>
                                ))}
                            </EditorCommandList>
                        </EditorCommand>

                        {/* ── Bubble menu ─────────────────────────────────────────── */}
                        <EditorBubble
                            tippyOptions={{ duration: 100 }}
                            className="novel-bubble-menu flex items-center gap-0.5 rounded-lg border border-border shadow-float px-1 py-0.5"
                        >
                            <BubbleButton mark="bold"      icon={<Bold size={13} />}          title="加粗"   onSelect={(e) => e.chain().focus().toggleBold().run()} />
                            <BubbleButton mark="italic"    icon={<Italic size={13} />}        title="斜体"   onSelect={(e) => e.chain().focus().toggleItalic().run()} />
                            <BubbleButton mark="strike"    icon={<Strikethrough size={13} />} title="删除线" onSelect={(e) => e.chain().focus().toggleStrike().run()} />
                            <BubbleButton mark="code"      icon={<Code size={13} />}          title="代码"   onSelect={(e) => e.chain().focus().toggleCode().run()} />
                            <BubbleButton mark="highlight" icon={<span className="text-[11px] font-bold leading-none" style={{ fontFamily: 'serif' }}>A</span>} title="高亮" onSelect={(e) => e.chain().focus().toggleHighlight().run()} />
                            <AnnotationBubbleButton onAnnotateSelection={onAnnotateSelection} />
                            {/* AI actions */}
                            <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
                            <AIBubbleButton command="improve"  icon={<Wand2 size={13} />}           title="AI 改写" label="AI 改写" />
                            <AIBubbleButton command="shorter"  icon={<Scissors size={13} />}         title="AI 缩短" label="AI 缩短" />
                            <AIBubbleButton command="longer"   icon={<ArrowDownToLine size={13} />}  title="AI 扩写" label="AI 扩写" />
                            <AIBubbleButton command="fix"      icon={<CheckSquare size={13} />}      title="AI 纠错" label="AI 纠错" />
                            <AIBubbleButton command="continue" icon={<ArrowUpRight size={13} />}     title="AI 续写" label="AI 续写" />
                        </EditorBubble>
                    </EditorContent>
                </EditorRoot>

                {/* ── AI confirm bar ───────────────────────────────────────── */}
                {pending && (
                    <AIConfirmBar
                        pending={pending}
                        onAccept={handleAccept}
                        onReject={handleReject}
                    />
                )}
                {annotationPopup && (
                    <div
                        className="fixed z-[140] w-72 -translate-x-1/2 rounded-lg border border-border bg-bg-container shadow-float px-3 py-2.5 text-left animate-slide-up"
                        style={{ left: annotationPopup.left, top: annotationPopup.top }}
                        onMouseEnter={clearAnnotationPopupTimer}
                        onMouseLeave={scheduleAnnotationPopupHide}
                    >
                        <div className="text-[11px] text-text-tertiary line-clamp-2 border-l-2 border-primary-mint/50 pl-2">
                            {annotationPopup.annotation.quote}
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-text whitespace-pre-wrap">
                            {annotationPopup.annotation.body}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-quaternary">
                            <CircleDot size={10} className={annotationPopup.annotation.status === 'open' ? 'text-primary-mint' : 'text-text-quaternary'} />
                            <span className="flex-1">{annotationPopup.annotation.status === 'open' ? '未解决' : '已解决'}</span>
                            {onAnnotationJump && (
                                <button
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => { onAnnotationJump(annotationPopup.annotation); setAnnotationPopup(null) }}
                                    className="hover:text-primary-mint transition-colors"
                                >
                                    定位
                                </button>
                            )}
                            {onAnnotationToggleStatus && (
                                <button
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => { onAnnotationToggleStatus(annotationPopup.annotation); setAnnotationPopup(null) }}
                                    className="hover:text-primary-mint transition-colors"
                                >
                                    {annotationPopup.annotation.status === 'open' ? '解决' : '打开'}
                                </button>
                            )}
                            {onAnnotationDelete && (
                                <button
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => { onAnnotationDelete(annotationPopup.annotation); setAnnotationPopup(null) }}
                                    className="inline-flex items-center gap-1 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 size={10} />
                                    删除
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </AIStateContext.Provider>
    )
})

function normalizeAnnotationText(text: string): string {
    return text.replace(/\s+/g, '').trim()
}
