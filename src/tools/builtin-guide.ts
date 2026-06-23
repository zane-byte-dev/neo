/**
 * src/tools/builtin-guide.ts — Auto-generate the built-in tools reference section
 * for the system prompt.
 *
 * This section is injected automatically by buildTenantSystemInstruction() so that
 * per-user TOOLS.md files need not (and should not) document system built-in tools.
 * When a built-in tool is added, renamed, or removed, only this file needs updating.
 */

import { TOOL_DECLARATIONS } from './executor.js';
import { TOOL_SUMMARIES, TOOL_DISPLAY_ORDER, buildToolCatalog, renderCompactCatalog } from './tool-catalog.js';
import type { Tool, ToolContext } from '../llm/types.js';

/** Documentation density for the injected tools section. */
export type ToolGuideMode = 'full' | 'compact';

/**
 * Build a Markdown tools-reference block from:
 *  - TOOL_DECLARATIONS (executor built-ins: bash, read_file, write_file, list_dir)
 *  - toolRegistry       (internal tools registered via setupTools())
 *
 * The resulting section is suitable for direct inclusion in the system prompt.
 *
 * In `compact` mode only a name | summary | tier table is emitted (the lazy
 * tool-context experience); the model expands full detail on demand via
 * `search_tools`. `full` mode (default) is byte-compatible with the legacy
 * behaviour and is used as the fallback.
 */
export function buildBuiltinToolsGuide(
    toolRegistry: Map<string, Tool>,
    mode: ToolGuideMode = 'full',
    context?: ToolContext,
): string {
    if (mode === 'compact') {
        return renderCompactCatalog(buildToolCatalog(toolRegistry, context));
    }

    const rows: Array<[string, string]> = [];

    // Curated "when to use" descriptions keyed by tool name (Chinese, user-facing)
    const whenToUse: Record<string, string> = TOOL_SUMMARIES;

    // Collect known tool names in a stable, logical order
    const orderedNames: string[] = TOOL_DISPLAY_ORDER;

    const allDeclaredNames = new Set([
        ...TOOL_DECLARATIONS.map(d => d.name),
        ...toolRegistry.keys(),
    ]);

    // Emit rows in the curated order, then any remaining tools not in orderedNames
    const emitted = new Set<string>();
    for (const name of orderedNames) {
        if (!allDeclaredNames.has(name)) continue;
        const when = whenToUse[name] ?? name;
        rows.push([when, `\`${name}\``]);
        emitted.add(name);
    }
    for (const name of allDeclaredNames) {
        if (emitted.has(name)) continue;
        const when = whenToUse[name] ?? name;
        rows.push([when, `\`${name}\``]);
    }

    const tableRows = rows.map(([when, tool]) => `| ${when} | ${tool} |`).join('\n');

    return `## 可用工具速查

| 需求 | 工具 |
|------|------|
${tableRows}

## 文件操作原则

- **修改已有文件时，优先用 \`edit_file\`**（精确替换，不会破坏其他内容）
- 新建文件：\`write_file\` 直接创建，或 \`bash\` heredoc
- 修改前先用 \`read_file\` 确认文件内容，确保 \`old_str\` 能唯一匹配
- 写文件用绝对路径，避免相对路径歧义
- \`read_file\` 输出上限 50k 字符；超大文件改用 \`bash head\` 分段读

## 搜索原则

- 搜索文件**内容**（含某个关键词/模式）→ 用 \`grep\`
- 搜索文件**路径**（按名称/扩展名定位文件）→ 用 \`glob\`
- 复杂管道操作（如 find + xargs + sort）→ 用 \`bash\`

## 任务管理原则

- 处理**多步骤复杂任务**时，先用 \`todo\` 列出步骤，每步执行前标 \`in_progress\`，完成后标 \`done\`
- 长任务中途汇报进度 → 用 \`run_skill(name: "brief")\``;
}
