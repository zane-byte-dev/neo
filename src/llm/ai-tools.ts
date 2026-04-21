/**
 * src/llm/ai-tools.ts — Bridge between our Tool registry and AI SDK tool format.
 *
 * Converts the app's FunctionDeclaration + executeTool into AI SDK CoreTool
 * objects that can be passed to streamText() / generateText().
 */

import { tool, jsonSchema, type ToolSet } from 'ai';
import { executeTool, TOOL_DECLARATIONS } from '../tools/executor.js';
import { isAllowedInPlanMode } from '../tools/tool-permissions.js';
import type { Tool, ToolContext } from './types.js';

/**
 * Build an AI SDK tools record from our built-in declarations + custom tool registry.
 * All tool execution flows through the existing `executeTool()` which retains
 * security checks (dangerous command blocking, path traversal, etc.).
 *
 * In plan mode, only tools whose permission tier is 'read' are exposed
 * (plus `exit_plan_mode` — see tool-permissions.ts).
 */
export function buildAiTools(
    toolRegistry: Map<string, Tool>,
    workDir: string,
    context?: ToolContext,
): ToolSet {
    const tools: ToolSet = {};
    const isPlanMode = context?.mode === 'plan';

    // Built-in tools (bash, read_file, write_file, list_dir)
    for (const decl of TOOL_DECLARATIONS) {
        if (isPlanMode && !isAllowedInPlanMode(decl.name)) continue;
        tools[decl.name] = tool({
            description: decl.description,
            inputSchema: jsonSchema(decl.parameters),
            execute: async (args) =>
                executeTool(decl.name, args as Record<string, unknown>, workDir, toolRegistry, context),
        });
    }

    // Custom tools from the registry
    for (const [name, t] of toolRegistry) {
        if (isPlanMode && !isAllowedInPlanMode(name, t)) continue;
        tools[name] = tool({
            description: t.declaration.description,
            inputSchema: jsonSchema(t.declaration.parameters),
            execute: async (args) =>
                executeTool(name, args as Record<string, unknown>, workDir, toolRegistry, context),
        });
    }

    // Per-user tools from .tools/ directory
    const userTools = context?.userTools;
    if (userTools) {
        for (const [name, t] of userTools) {
            if (isPlanMode && !isAllowedInPlanMode(name, t)) continue;
            tools[name] = tool({
                description: t.declaration.description,
                inputSchema: jsonSchema(t.declaration.parameters),
                execute: async (args) => {
                    const result = await t.handler(args as Record<string, unknown>, workDir, context);
                    return result;
                },
            });
        }
    }

    return tools;
}

/**
 * Build a ToolSet restricted to a specific set of tool names.
 * Used by the subagent tool to give child agents a limited toolbox.
 * Falls back to all tools if `names` is empty.
 */
export function buildAiToolSubset(
    names: string[],
    toolRegistry: Map<string, Tool>,
    workDir: string,
    context?: ToolContext,
): ToolSet {
    const all = buildAiTools(toolRegistry, workDir, context);
    if (!names.length) return all;

    const subset: ToolSet = {};
    for (const name of names) {
        if (all[name]) subset[name] = all[name];
    }
    return subset;
}
