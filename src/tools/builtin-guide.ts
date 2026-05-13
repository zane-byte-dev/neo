/**
 * src/tools/builtin-guide.ts — Auto-generate the built-in tools reference section
 * for the system prompt.
 *
 * This section is injected automatically by buildTenantSystemInstruction() so that
 * per-user TOOLS.md files need not (and should not) document system built-in tools.
 * When a built-in tool is added, renamed, or removed, only this file needs updating.
 */

import { TOOL_DECLARATIONS } from './executor.js';
import type { Tool } from '../llm/types.js';

/**
 * Build a Markdown tools-reference block from:
 *  - TOOL_DECLARATIONS (executor built-ins: bash, read_file, write_file, list_dir)
 *  - toolRegistry       (internal tools registered via setupTools())
 *
 * The resulting section is suitable for direct inclusion in the system prompt.
 */
export function buildBuiltinToolsGuide(toolRegistry: Map<string, Tool>): string {
    const rows: Array<[string, string]> = [];

    // Curated "when to use" descriptions keyed by tool name (Chinese, user-facing)
    const whenToUse: Record<string, string> = {
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
    };

    // Collect known tool names in a stable, logical order
    const orderedNames: string[] = [
        // execution
        'bash', 'code_exec',
        // file ops
        'read_file', 'edit_file', 'write_file', 'list_dir',
        // search
        'glob', 'grep',
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
