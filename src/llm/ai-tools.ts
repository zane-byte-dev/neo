/**
 * src/llm/ai-tools.ts — Bridge between our Tool registry and AI SDK tool format.
 *
 * Converts the app's FunctionDeclaration + executeTool into AI SDK CoreTool
 * objects that can be passed to streamText() / generateText().
 */

import { tool, jsonSchema, type ToolSet } from 'ai';
import { executeTool, TOOL_DECLARATIONS } from '../tools/executor.js';
import type { Tool, ToolContext } from './types.js';

/**
 * Build an AI SDK tools record from our built-in declarations + custom tool registry.
 * All tool execution flows through the existing `executeTool()` which retains
 * security checks (dangerous command blocking, path traversal, etc.).
 */
export function buildAiTools(
    toolRegistry: Map<string, Tool>,
    workDir: string,
    context?: ToolContext,
): ToolSet {
    const tools: ToolSet = {};

    // Built-in tools (bash, read_file, write_file, list_dir)
    for (const decl of TOOL_DECLARATIONS) {
        tools[decl.name] = tool({
            description: decl.description,
            inputSchema: jsonSchema(decl.parameters),
            execute: async (args) =>
                executeTool(decl.name, args as Record<string, unknown>, workDir, toolRegistry, context),
        });
    }

    // Custom tools from the registry
    for (const [name, t] of toolRegistry) {
        tools[name] = tool({
            description: t.declaration.description,
            inputSchema: jsonSchema(t.declaration.parameters),
            execute: async (args) =>
                executeTool(name, args as Record<string, unknown>, workDir, toolRegistry, context),
        });
    }

    return tools;
}
