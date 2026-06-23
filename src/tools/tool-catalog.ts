/**
 * src/tools/tool-catalog.ts — Single source of per-tool metadata for the
 * "lazy tool context" experience.
 *
 * Two consumers share this module:
 *  - The compact tool catalog injected into the system prompt
 *    (`builtin-guide.ts` in `compact` mode) — name + one-line summary + tier.
 *  - The `search_tools` tool, which expands the full description / schema for a
 *    matched tool on demand (`lookupToolDetail`).
 *
 * Keeping both paths backed by one metadata source guarantees the compact
 * catalog and the on-demand detail stay consistent.
 */

import { TOOL_DECLARATIONS } from './executor.js';
import { resolveToolPermission, isAllowedInPlanMode } from './tool-permissions.js';
import type { FunctionDeclaration, Tool, ToolContext, ToolPermission } from '../llm/types.js';

export interface ToolCatalogEntry {
    name: string;
    /** One-line, user-facing purpose. */
    summary: string;
    permission: ToolPermission;
    /** Full tool description (from the declaration). */
    description: string;
    /** Full JSON-schema parameters (from the declaration). */
    schema: FunctionDeclaration['parameters'];
    /** Logical grouping, when the tool declares one via `meta.category`. */
    category?: string;
}

/**
 * Curated one-line summaries keyed by tool name (Chinese, user-facing).
 * Canonical source — `builtin-guide.ts` imports this instead of duplicating it.
 */
export const TOOL_SUMMARIES: Record<string, string> = {
    // executor built-ins
    bash:                 '执行命令、git 操作、脚本',
    read_file:            '读取指定文件',
    write_file:           '创建新文件或全量覆写',
    list_dir:             '列出目录内容',
    // internal tools
    edit_file:            '**局部修改文件（推荐）**',
    glob:                 '按 glob 模式查找文件路径',
    grep:                 '按正则搜索文件内容',
    fetch_url:            '抓取网页内容',
    search_web:           '搜索网络',
    browser_command:      '**操控真实浏览器**（登录、点击、填表、截图、JS 执行、需要交互的网页）',
    get_datetime:         '获取当前日期时间',
    get_weather:          '获取天气',
    generate_video:       '生成视频',
    notebook_search:      '在 Notebook 模式下检索当前来源并返回可引用段落',
    todo:                 '管理任务清单（多步骤任务）',
    update_now:           '更新当前关注点/近况记忆',
    update_user_profile:  '更新用户档案 USER.md',
    save_memory:          '保存长期记忆',
    manage_skill:         '创建/更新可复用 skill（把当前对话沉淀成 skill）',
    subagent:             '派生子任务给子 agent',
    ask_user:             '向用户提问确认',
    enter_plan_mode:      '进入计划模式',
    exit_plan_mode:       '退出计划模式',
    research:             '深度研究（多轮 search + fetch）',
    run_skill:            '执行已注册的 skill',
    list_skills:          '列出所有可用 skill',
    code_exec:            '沙箱执行代码',
    get_chat_history:     '获取历史对话记录',
    search_tools:         '检索某个工具的完整说明、参数 schema 与示例',
};

/**
 * Stable, logical display order for the catalog. Tools not listed here are
 * appended afterwards in registry order.
 */
export const TOOL_DISPLAY_ORDER: string[] = [
    // execution
    'bash', 'code_exec',
    // file ops
    'read_file', 'edit_file', 'write_file', 'list_dir',
    // search
    'glob', 'grep', 'search_tools',
    // web
    'fetch_url', 'search_web', 'browser_command', 'research',
    // utility
    'get_datetime', 'get_weather', 'generate_video',
    // memory & profile
    'notebook_search', 'update_now', 'update_user_profile', 'save_memory', 'get_chat_history',
    // agent control
    'manage_skill',
    'todo', 'ask_user', 'enter_plan_mode', 'exit_plan_mode',
    'subagent', 'run_skill', 'list_skills',
];

/** Take the first sentence/line of a description as a fallback summary. */
function firstLine(text: string): string {
    const trimmed = text.trim();
    const stop = trimmed.search(/[。.\n]/);
    const head = stop > 0 ? trimmed.slice(0, stop) : trimmed;
    return head.length > 80 ? `${head.slice(0, 77)}…` : head;
}

/** Resolve the one-line summary for a tool (curated map → first line → name). */
export function summaryFor(name: string, declaration?: FunctionDeclaration): string {
    const curated = TOOL_SUMMARIES[name];
    if (curated) return curated;
    if (declaration?.description) return firstLine(declaration.description);
    return name;
}

/** Build a catalog entry from a declaration (+ optional registered tool). */
function toEntry(declaration: FunctionDeclaration, tool?: Tool): ToolCatalogEntry {
    const name = declaration.name;
    const entry: ToolCatalogEntry = {
        name,
        summary: summaryFor(name, declaration),
        permission: resolveToolPermission(name, tool),
        description: declaration.description,
        schema: declaration.parameters,
    };
    if (tool?.meta?.category) entry.category = tool.meta.category;
    return entry;
}

/**
 * Collect declarations for all exposed tools (built-ins + registry + per-user
 * tools), deduped by name with built-ins taking precedence, ordered by
 * TOOL_DISPLAY_ORDER then registry order.
 */
function collectDeclarations(
    toolRegistry: Map<string, Tool>,
    context?: ToolContext,
): Array<{ declaration: FunctionDeclaration; tool?: Tool }> {
    const byName = new Map<string, { declaration: FunctionDeclaration; tool?: Tool }>();

    for (const decl of TOOL_DECLARATIONS) {
        byName.set(decl.name, { declaration: decl });
    }
    for (const [name, t] of toolRegistry) {
        if (!byName.has(name)) byName.set(name, { declaration: t.declaration, tool: t });
    }
    for (const [name, t] of context?.userTools ?? []) {
        if (!byName.has(name)) byName.set(name, { declaration: t.declaration, tool: t });
    }

    const ordered: Array<{ declaration: FunctionDeclaration; tool?: Tool }> = [];
    const emitted = new Set<string>();
    for (const name of TOOL_DISPLAY_ORDER) {
        const found = byName.get(name);
        if (found) {
            ordered.push(found);
            emitted.add(name);
        }
    }
    for (const [name, found] of byName) {
        if (!emitted.has(name)) ordered.push(found);
    }
    return ordered;
}

/** True iff the tool should be visible given the current read-only mode. */
function visibleInMode(name: string, tool: Tool | undefined, context?: ToolContext): boolean {
    const readOnly = context?.mode === 'plan' || context?.mode === 'notebook';
    if (!readOnly) return true;
    return isAllowedInPlanMode(name, tool);
}

/**
 * Build the full tool catalog, filtered to what is exposed in the current mode.
 */
export function buildToolCatalog(
    toolRegistry: Map<string, Tool>,
    context?: ToolContext,
): ToolCatalogEntry[] {
    return collectDeclarations(toolRegistry, context)
        .filter(({ declaration, tool }) => visibleInMode(declaration.name, tool, context))
        .map(({ declaration, tool }) => toEntry(declaration, tool));
}

const TIER_LABEL: Record<ToolPermission, string> = {
    read: '只读',
    write: '写入',
    dangerous: '危险',
};

/** Render a compact catalog table: 工具 | 用途 | 权限. */
export function renderCompactCatalog(entries: ToolCatalogEntry[]): string {
    const rows = entries
        .map((e) => `| \`${e.name}\` | ${e.summary} | ${TIER_LABEL[e.permission]} |`)
        .join('\n');
    return `## 可用工具速查（精简）

> 仅列出工具名与用途。需要某个工具的完整参数 / 示例时，调用 \`search_tools\` 展开。

| 工具 | 用途 | 权限 |
|------|------|------|
${rows}`;
}

/**
 * Look up full detail for tools matching a query / name / category.
 *
 * Matching is lexical (first slice — no embeddings):
 *  - `name`: exact, case-insensitive.
 *  - `category`: exact category match.
 *  - `query`: substring match across name / summary / description.
 *
 * Results respect the current read-only mode (plan / notebook) via the catalog.
 */
export function lookupToolDetail(
    params: { name?: string; query?: string; category?: string },
    toolRegistry: Map<string, Tool>,
    context?: ToolContext,
): ToolCatalogEntry[] {
    const catalog = buildToolCatalog(toolRegistry, context);
    const name = params.name?.trim().toLowerCase();
    const category = params.category?.trim().toLowerCase();
    const query = params.query?.trim().toLowerCase();

    if (name) {
        return catalog.filter((e) => e.name.toLowerCase() === name);
    }
    if (category) {
        return catalog.filter((e) => (e.category ?? '').toLowerCase() === category);
    }
    if (query) {
        return catalog.filter(
            (e) =>
                e.name.toLowerCase().includes(query) ||
                e.summary.toLowerCase().includes(query) ||
                e.description.toLowerCase().includes(query),
        );
    }
    return [];
}

/** Render a single catalog entry as a detailed Markdown block. */
export function renderToolDetail(entry: ToolCatalogEntry): string {
    const schema = JSON.stringify(entry.schema, null, 2);
    return [
        `### \`${entry.name}\``,
        `- 用途：${entry.summary}`,
        `- 权限层级：${TIER_LABEL[entry.permission]}`,
        ...(entry.category ? [`- 分类：${entry.category}`] : []),
        '',
        '说明：',
        entry.description,
        '',
        '参数 schema：',
        '```json',
        schema,
        '```',
    ].join('\n');
}
