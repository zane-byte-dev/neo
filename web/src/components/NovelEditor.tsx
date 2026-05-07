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
    Placeholder,
    type EditorInstance,
    type SuggestionItem,
    handleCommandNavigation,
    createSuggestionItems,
    renderItems,
    Command,
    useEditor,
} from 'novel'
import { Markdown } from 'tiptap-markdown'
import {
    Bold, Italic, Strikethrough, Code,
    Heading1, Heading2, Heading3,
    List, ListOrdered, Quote, Minus, Code2, Type,
} from 'lucide-react'
import { cn } from '../lib/utils'

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
                </EditorBubble>
            </EditorContent>
        </EditorRoot>
    )
}
