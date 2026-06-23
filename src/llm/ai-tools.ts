/**
 * src/llm/ai-tools.ts — Bridge between our Tool registry and AI SDK tool format.
 *
 * Converts the app's FunctionDeclaration + executeTool into AI SDK CoreTool
 * objects that can be passed to streamText() / generateText().
 */

import { tool, jsonSchema, type ToolSet } from 'ai';
import { executeTool, TOOL_DECLARATIONS } from '../tools/executor.js';
import { isAllowedInPlanMode } from '../tools/tool-permissions.js';
import { isAllowedByProfile } from '../agent/profiles/enforcement.js';
import { createToolLoopGuard, type ToolLoopGuard } from './tool-loop-guard.js';
import { classifyToolError, formatErrorHint } from './tool-error-classifier.js';
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
    const isNotebookMode = context?.mode === 'notebook';
    const isReadOnlyMode = isPlanMode || isNotebookMode;
    const profile = context?.profile;
    const guard = createToolLoopGuard();

    const wrapExecute = (
        name: string,
        run: (args: Record<string, unknown>) => Promise<string>,
        toolDef?: Tool,
    ) => async (args: Record<string, unknown>) => {
        const sc = guard.shortCircuit(name, args);
        if (sc) return sc;
        let result: string;
        try {
            result = await run(args);
        } catch (err) {
            // Execution threw — classify, record as a failure, and surface a hint.
            const errResult = `[Error] ${err instanceof Error ? err.message : String(err)}`;
            const thrown = classifyToolError(name, errResult, err, toolDef);
            guard.record(name, args, errResult);
            return thrown ? errResult + formatErrorHint(thrown) : errResult;
        }
        // Classify the (possibly failed) result and append a structured hint.
        const classified = classifyToolError(name, result, undefined, toolDef);
        // Record the original (un-annotated) result so loop-guard signatures stay stable.
        guard.record(name, args, result);
        return classified ? result + formatErrorHint(classified) : result;
    };

    // Built-in tools (bash, read_file, write_file, list_dir)
    for (const decl of TOOL_DECLARATIONS) {
        if (isReadOnlyMode && !isAllowedInPlanMode(decl.name)) continue;
        if (profile && !isAllowedByProfile(decl.name, undefined, profile)) continue;
        tools[decl.name] = tool({
            description: decl.description,
            inputSchema: jsonSchema(decl.parameters),
            execute: wrapExecute(decl.name, (args) =>
                executeTool(decl.name, args, workDir, toolRegistry, context),
            ),
        });
    }

    // Custom tools from the registry
    for (const [name, t] of toolRegistry) {
        if (isReadOnlyMode && !isAllowedInPlanMode(name, t)) continue;
        if (profile && !isAllowedByProfile(name, t, profile)) continue;
        tools[name] = tool({
            description: t.declaration.description,
            inputSchema: jsonSchema(t.declaration.parameters),
            execute: wrapExecute(
                name,
                (args) => executeTool(name, args, workDir, toolRegistry, context),
                t,
            ),
        });
    }

    // Per-user tools loaded from {stateDir}/tools/
    const userTools = context?.userTools;
    if (userTools) {
        for (const [name, t] of userTools) {
            if (isReadOnlyMode && !isAllowedInPlanMode(name, t)) continue;
            if (profile && !isAllowedByProfile(name, t, profile)) continue;
            tools[name] = tool({
                description: t.declaration.description,
                inputSchema: jsonSchema(t.declaration.parameters),
                execute: wrapExecute(name, (args) => t.handler(args, workDir, context), t),
            });
        }
    }

    return tools;
}

// Re-export for tests
export type { ToolLoopGuard };

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
