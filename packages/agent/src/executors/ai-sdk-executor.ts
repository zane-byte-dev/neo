/**
 * AI SDK based AgentExecutor adapter.
 *
 * This preserves the current LLMClient behavior while giving agent-runner a
 * replaceable executor boundary for future Claude Agent SDK / OpenAI Agents
 * SDK adapters.
 */

import { LLMClient } from '../llm/client.js';
import type { AgentExecutor, AgentExecutorContext, AgentExecutorInput } from './types.js';

export class AiSdkAgentExecutor implements AgentExecutor {
    readonly name = 'ai-sdk';

    constructor(private readonly client = new LLMClient()) {}

    async run(input: AgentExecutorInput, context: AgentExecutorContext): Promise<string | null> {
        return this.client.chatWithContextStreaming(
            input.message,
            input.history,
            context.toolContext,
            context.onEvent,
            context.signal,
            input.model,
            input.route,
            input.images,
        );
    }
}

