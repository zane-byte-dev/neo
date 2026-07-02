import { t } from '../../i18n'
import type { ActivityItem, MessagePart } from '../../types'

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
    bash: '执行命令',
    read_file: '读取文件',
    write_file: '写入文件',
    list_dir: '列出目录',
    edit_file: '编辑文件',
    glob: '查找文件',
    grep: '搜索内容',
    fetch_url: '抓取网页',
    search_web: '搜索网络',
    browser_command: '操控浏览器',
    get_datetime: '获取时间',
    get_weather: '获取天气',
    generate_video: '生成视频',
    notebook_search: '检索知识库',
    todo: '管理任务',
    update_now: '更新近况',
    update_user_profile: '更新档案',
    save_memory: '保存记忆',
    manage_skill: '管理技能',
    subagent: '派发子任务',
    ask_user: '请求确认',
    enter_plan_mode: '进入计划模式',
    exit_plan_mode: '退出计划模式',
    research: '深度调研',
    run_skill: '执行技能',
    list_skills: '列出技能',
    code_exec: '执行代码',
    get_chat_history: '查看历史',
}

export function toolDisplayName(toolName: string): string {
    return TOOL_DISPLAY_NAMES[toolName] ?? toolName
}

export const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep'])
export const WEB_TOOLS = new Set(['search_web', 'fetch_url', 'research', 'browser_command'])
export const RUN_TOOLS = new Set(['bash', 'code_exec'])

export function activityPreviewText(item: ActivityItem): string {
    if (typeof item.args?.command === 'string') return item.args.command
    if (item.type === 'tool_result') return item.result ?? ''
    return item.args ? JSON.stringify(item.args) : ''
}

export function semanticPreview(item: ActivityItem, max = 120): string {
    if (item.type === 'tool_result') return ''
    const args = item.args ?? {}
    const toolName = item.toolName

    if (FILE_TOOLS.has(toolName)) {
        if (typeof args.path === 'string') {
            return args.path.split('/').pop() ?? args.path
        }
        if (typeof args.pattern === 'string') return compactPreview(args.pattern, max)
        if (typeof args.query === 'string') return compactPreview(`"${args.query}"`, max)
    }
    if (typeof args.command === 'string') return compactPreview(args.command, max)
    if (toolName === 'search_web' && typeof args.query === 'string') return compactPreview(args.query, max)
    if (toolName === 'fetch_url' && typeof args.url === 'string') return compactPreview(args.url, max)
    if (toolName === 'research' && typeof args.topic === 'string') return compactPreview(args.topic, max)
    if (toolName === 'run_skill' && typeof args.skill_name === 'string') return args.skill_name
    if (toolName === 'manage_skill' && typeof args.name === 'string') return args.name
    if (toolName === 'subagent' && typeof args.task === 'string') return compactPreview(args.task, max)
    if (!args || Object.keys(args).length === 0) return ''

    const pairs = Object.entries(args)
        .filter(([key]) => !['content', 'old_str', 'new_str'].includes(key))
        .map(([key, value]) => {
            const normalized = typeof value === 'string'
                ? value
                : (typeof value === 'number' || typeof value === 'boolean')
                    ? String(value)
                    : JSON.stringify(value)
            return `${key}: ${normalized}`
        })
        .join('  ·  ')

    return compactPreview(pairs, max)
}

export function compactPreview(text: string, max = 96): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

export type ActivityDisplayItem = {
    item: ActivityItem
    resultItem?: ActivityItem
}

type RenderPart =
    | { type: 'text'; content: string }
    | { type: 'activity'; item: ActivityItem; resultItem?: ActivityItem }
    | { type: 'activity-batch'; items: ActivityDisplayItem[] }

function canMergeActivityItems(current: ActivityItem, next: ActivityItem): boolean {
    if (next.type !== 'tool_result') return false
    if (current.type !== 'tool_call' && current.type !== 'tool_confirm') return false
    if (current.toolName !== next.toolName) return false
    return true
}

export function mergeActivityItems(items: ActivityItem[]): ActivityDisplayItem[] {
    const merged: ActivityDisplayItem[] = []
    for (const item of items) {
        const last = merged[merged.length - 1]
        if (last && !last.resultItem && canMergeActivityItems(last.item, item)) {
            last.resultItem = item
            continue
        }
        merged.push({ item })
    }
    return merged
}

export function generateBatchSummary(items: ActivityDisplayItem[]): string {
    const counts: Record<string, number> = {}
    for (const { item } of items) counts[item.toolName] = (counts[item.toolName] ?? 0) + 1
    const toolNames = Object.keys(counts)
    const total = items.length

    if (total === 1) {
        const { item } = items[0]
        const label = toolDisplayName(item.toolName)
        const preview = semanticPreview(item, 60)
        return preview ? `${label}  ${preview}` : label
    }

    const fileCount = toolNames.filter((name) => FILE_TOOLS.has(name)).reduce((sum, name) => sum + counts[name], 0)
    const webCount = toolNames.filter((name) => WEB_TOOLS.has(name)).reduce((sum, name) => sum + counts[name], 0)
    const runCount = toolNames.filter((name) => RUN_TOOLS.has(name)).reduce((sum, name) => sum + counts[name], 0)

    if (toolNames.length === 1) {
        const count = counts[toolNames[0]]
        return `${toolDisplayName(toolNames[0])} × ${count}`
    }
    if (fileCount > 0 && webCount === 0 && runCount === 0 && toolNames.every((name) => FILE_TOOLS.has(name))) {
        return t('activityBatchFiles', { count: fileCount })
    }
    if (webCount > 0 && fileCount === 0 && runCount === 0 && toolNames.every((name) => WEB_TOOLS.has(name))) {
        return t('activityBatchWeb', { count: webCount })
    }
    if (fileCount > 0 && webCount > 0 && runCount === 0) {
        return t('activityBatchWebFiles', { count: fileCount + webCount })
    }
    if (runCount > 0 && fileCount === 0 && webCount === 0) {
        return t('activityBatchCommands', { count: runCount })
    }
    return t('activityBatchOps', { count: total })
}

export function mergeMessageParts(parts: MessagePart[]): RenderPart[] {
    const merged: RenderPart[] = []
    for (const part of parts) {
        if (part.type === 'text') {
            const last = merged[merged.length - 1]
            if (last?.type === 'text') {
                last.content += part.content
            } else {
                merged.push({ type: 'text', content: part.content })
            }
            continue
        }

        const last = merged[merged.length - 1]
        if (last?.type === 'activity-batch') {
            const batchLast = last.items[last.items.length - 1]
            if (batchLast && !batchLast.resultItem && canMergeActivityItems(batchLast.item, part.item)) {
                batchLast.resultItem = part.item
                continue
            }
            last.items.push({ item: part.item })
            continue
        }
        if (last?.type === 'activity' && !last.resultItem && canMergeActivityItems(last.item, part.item)) {
            merged[merged.length - 1] = { type: 'activity-batch', items: [{ item: last.item, resultItem: part.item }] }
            continue
        }
        merged.push({ type: 'activity-batch', items: [{ item: part.item }] })
    }

    return merged.map((part) => {
        if (part.type === 'activity-batch' && part.items.length === 1) {
            const { item, resultItem } = part.items[0]
            return { type: 'activity' as const, item, resultItem }
        }
        return part
    })
}
