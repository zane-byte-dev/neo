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
} from 'lucide-react'
import { cn } from '../lib/utils'

// ─── AI completion helper ─────────────────────────────────────────────────────

type AICommand = 'continue' | 'improve' | 'shorter' | 'longer' | 'fix'

async function streamAICompletion(
    prompt: string,
    command: AICommand,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, command }),
        signal,
    })
    if (!res.ok || !res.body) throw new Error(`AI request failed: ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        onChunk(decoder.decode(value, { stream: true }))
    }
}

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
    {
        title: 'AI 续写',
        description: '根据已有内容继续写作',
        searchTerms: ['ai', 'continue', '续写', '继续'],
        icon: <Sparkles size={16} />,
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            const text = getPrevText(editor, { chars: 5000 })
            if (!text.trim()) return
            const pos = editor.state.selection.to
            addAIHighlight(editor)
            const ctrl = new AbortController()
            let inserted = 0
            streamAICompletion(text, 'continue', (chunk) => {
                editor.chain().focus().insertContentAt(pos + inserted, chunk).run()
                inserted += chunk.length
            }, ctrl.signal).then(() => {
                removeAIHighlight(editor)
            }).catch(() => {
                removeAIHighlight(editor)
            })
        },
    },
    {
        title: 'AI 改写',
        description: '改进选中文本的表达',
        searchTerms: ['ai', 'improve', 'rewrite', '改写', '优化'],
        icon: <Wand2 size={16} />,
        command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            const text = getPrevText(editor, { chars: 5000 })
            if (!text.trim()) return
            const pos = editor.state.selection.to
            addAIHighlight(editor)
            let inserted = 0
            streamAICompletion(text, 'improve', (chunk) => {
                editor.chain().focus().insertContentAt(pos + inserted, chunk).run()
                inserted += chunk.length
            }).then(() => removeAIHighlight(editor)).catch(() => removeAIHighlight(editor))
        },
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

// ─── AI bubble button ─────────────────────────────────────────────────────────

interface AIBubbleButtonProps {
    command: AICommand | 'continue'
    icon: React.ReactNode
    title: string
}

const AIBubbleButton: React.FC<AIBubbleButtonProps> = ({ command, icon, title }) => {
    const { editor } = useEditor()
    const [loading, setLoading] = React.useState(false)

    const handleSelect = async (ed: EditorInstance) => {
        if (loading || !ed) return
        const { from, to } = ed.state.selection
        const selectedText = ed.state.doc.textBetween(from, to, '\n')
        const text = selectedText || getPrevText(ed, { chars: 5000 })
        if (!text.trim()) return

        setLoading(true)
        addAIHighlight(ed)

        // Insert after current selection
        const insertPos = to

        try {
            let inserted = 0
            // If text was selected, delete it first and write the AI output in place
            if (selectedText) {
                ed.chain().focus().deleteSelection().run()
                await streamAICompletion(text, command as AICommand, (chunk) => {
                    ed.chain().focus().insertContentAt(from + inserted, chunk).run()
                    inserted += chunk.length
                })
            } else {
                await streamAICompletion(text, command as AICommand, (chunk) => {
                    ed.chain().focus().insertContentAt(insertPos + inserted, chunk).run()
                    inserted += chunk.length
                })
            }
        } catch {
            // silently ignore cancelled requests
        } finally {
            removeAIHighlight(ed)
            setLoading(false)
        }
    }

    return (
        <EditorBubbleItem onSelect={handleSelect} className="p-0">
            <button
                title={title}
                disabled={loading}
                className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-fill hover:text-primary-mint transition-colors',
                    loading && 'animate-pulse text-primary-mint',
                    editor?.isActive('ai-highlight') && loading && 'bg-fill'
                )}
            >
                {icon}
            </button>
        </EditorBubbleItem>
    )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NovelEditorProps {
    /** Initial Markdown content */
    initialContent: string
    placeholder?: string
    /** Called on every change with the latest Markdown string */
    onChange?: (markdown: string) => void
    className?: string
}

export const NovelEditor: React.FC<NovelEditorProps> = ({
    initialContent,
    placeholder = '开始写作…',
    onChange,
    className,
}) => {
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

    return (
        <EditorRoot>
            <EditorContent
                className={cn('relative w-full', className)}
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
                    // tiptap-markdown intercepts setContent for markdown strings
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
                    {/* AI actions */}
                    <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
                    <AIBubbleButton command="improve" icon={<Wand2 size={13} />}          title="AI 改写" />
                    <AIBubbleButton command="shorter" icon={<Scissors size={13} />}        title="AI 缩短" />
                    <AIBubbleButton command="longer"  icon={<ArrowDownToLine size={13} />} title="AI 扩写" />
                    <AIBubbleButton command="fix"     icon={<CheckSquare size={13} />}     title="AI 纠错" />
                    <AIBubbleButton command="continue" icon={<ArrowUpRight size={13} />}   title="AI 续写" />
                </EditorBubble>
            </EditorContent>
        </EditorRoot>
    )
}
