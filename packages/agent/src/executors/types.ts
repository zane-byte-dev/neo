/**
 * Agent executor contracts.
 *
 * AgentExecutor runs the model/tool loop strategy. It does not own durable run
 * state, approval queues, or tool execution; those stay in runtime.
 */

import type { SmartRouteDecision } from '../llm/model-router.js';
import type { StreamCallback, ToolContext } from '../llm/types.js';

export interface AgentExecutorHistoryItem {
    role: 'assistant' | 'user';
    content: string;
}

export interface AgentExecutorInput {
    message: string;
    history: AgentExecutorHistoryItem[];
    model: string;
    route?: SmartRouteDecision;
    images?: string[];
}

export interface AgentExecutorContext {
    toolContext: ToolContext;
    onEvent: StreamCallback;
    signal?: AbortSignal;
}

export interface AgentExecutor {
    readonly name: string;
    run(input: AgentExecutorInput, context: AgentExecutorContext): Promise<string | null>;
}

