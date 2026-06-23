/**
 * App-level ToolExecutor adapter for Neo's current tool system.
 *
 * Runtime owns the ToolExecutor contract; the Neo app wires that contract to
 * concrete tool declarations, handlers, approval, sandbox, and result policy.
 */

import { executeTool } from '../tools/executor.js';
import type { Tool, ToolContext } from '../llm/types.js';
import type { RuntimeToolCallRequest, ToolExecutor } from '../runtime/index.js';

export function createNeoToolExecutor(toolRegistry: Map<string, Tool>): ToolExecutor {
    return {
        execute(request: RuntimeToolCallRequest): Promise<string> {
            return executeTool(
                request.name,
                request.args,
                request.workDir,
                toolRegistry,
                request.context as ToolContext | undefined,
            );
        },
    };
}
