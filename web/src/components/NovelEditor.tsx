/**
 * NovelEditor — Novel/Tiptap-based rich text editor
 *
 * Content is stored/emitted as Markdown (via tiptap-markdown) to keep the
 * backend API unchanged.  The editor key must be managed by the parent
 * (e.g. key={note?.id ?? 'new'}) so React remounts when switching notes.
 */
import React from 'react'
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
    Check, X as XIcon, MessageSquarePlus,
} from 'lucide-react'
import { cn } from '../lib/utils'

const ANNOTATION_CONTEXT_LENGTH = 200

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

const SUGGESTION_ITEMS: SuggestionItem[] = createSuggestionItems([
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
        ed.chain().focus().toggleHighlight().run()
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
    focusRange?: { startOffset: number; endOffset: number; requestId: number } | null
    className?: string
}

export const NovelEditor: React.FC<NovelEditorProps> = ({
    initialContent,
    placeholder = '开始写作…',
    onChange,
    onAnnotateSelection,
    focusRange,
    className,
}) => {
    const [pending, setPending] = React.useState<AIPendingState | null>(null)
    const editorRef = React.useRef<EditorInstance | null>(null)

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
    const extensions = React.useMemo((): any[] => [
        StarterKit.configure({
            heading: { levels: [1, 2, 3] },
        }),
        AIHighlight,
        HighlightExtension,
        Markdown.configure({
            html: false,
            transformPastedText: true,
            transformCopiedText: true,
        }),
        Placeholder.configure({ placeholder }),
        Command.configure({
            suggestion: {
                items: ({ query }: { query: string }) =>
                    query
                        ? SUGGESTION_ITEMS.filter(
                              (item) =>
                                  item.title.toLowerCase().includes(query.toLowerCase()) ||
                                  item.description?.toLowerCase().includes(query.toLowerCase()) ||
                                  item.searchTerms?.some((t) => t.includes(query.toLowerCase()))
                          )
                        : SUGGESTION_ITEMS,
                render: renderItems,
            },
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [placeholder])

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
                                {SUGGESTION_ITEMS.map((item, i) => (
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
            </div>
        </AIStateContext.Provider>
    )
}
