/**
 * docActions.ts — shared AI doc action definitions.
 *
 * Used by NoteEditor "more menu" (AI section) and ResourcesPanel.
 * Two categories:
 *   'edit'    → triggers DocDiffModal (line-level diff, accept/reject per hunk)
 *   'insight' → sends prompt to chat (opens ChatDrawer)
 */
import type { LucideIcon } from 'lucide-react'

export interface DocEditAction {
    id: string
    label: string
    icon: LucideIcon
    iconColor: string
    desc: string
    category: 'edit'
    editInstruction: string
}

export interface DocInsightAction {
    id: string
    label: string
    icon: LucideIcon
    iconColor: string
    desc: string
    category: 'insight'
    buildPrompt: (title: string, content: string) => string
}

export type DocAction = DocEditAction | DocInsightAction

// ── Import icons lazily to avoid circular deps ───────────────────────────────
// Consumers are responsible for importing icons and passing them if needed;
// here we export plain action metadata (no JSX).

import { Wand2, AlignLeft, PenLine, Languages } from 'lucide-react'

export const EDIT_ACTIONS: DocEditAction[] = [
    {
        id: 'polish',
        label: '优化文档',
        icon: Wand2,
        iconColor: 'text-violet-500',
        desc: '改善表达流畅度、逻辑结构与专业度',
        category: 'edit',
        editInstruction: '优化以下段落，改善表达流畅度、逻辑结构和整体专业度，保持原文意思和结构不变。只输出修改后的段落内容，不要解释。',
    },
    {
        id: 'format',
        label: '格式化',
        icon: AlignLeft,
        iconColor: 'text-blue-500',
        desc: '规范 Markdown 格式、标题层级与排版',
        category: 'edit',
        editInstruction: '对以下段落进行 Markdown 格式规范化：统一标题层级、修正列表格式、整理代码块。只输出规范化后的内容，不要解释。',
    },
    {
        id: 'expand',
        label: '扩写改写',
        icon: PenLine,
        iconColor: 'text-teal-500',
        desc: '补充细节，扩展内容或换一种写法',
        category: 'edit',
        editInstruction: '对以下段落进行扩写改写：补充细节、举例说明，使内容更丰富完整，保持原有观点和风格。只输出改写后的内容，不要解释。',
    },
]

export const INSIGHT_ACTIONS: DocInsightAction[] = [
    {
        id: 'translate',
        label: '翻译英文',
        icon: Languages,
        iconColor: 'text-amber-500',
        desc: '将文章翻译为流畅英文（结果在对话中查看）',
        category: 'insight',
        buildPrompt: (title, content) =>
            `请将以下文章「${title}」翻译为流畅自然的英文，保持原文结构与格式。\n\n---\n\n${content}`,
    },
]
