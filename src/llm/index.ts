/**
 * src/llm/index.ts — Public API of the LLM module.
 *
 * Import from here in new code:
 *   import { LLMClient, registerTool } from '../llm/index.js';
 */

// Core types
export type {
    StreamChunk,
    StreamCallback,
    FunctionDeclaration,
    ToolMeta,
    Tool,
    ToolContext,
} from './types.js';

// AI SDK tool bridge
export { buildAiTools } from './ai-tools.js';

// Client
export {
    LLMClient,
    createLLMClient,
    resolveModel,
    registerTool,
    getToolRegistry,
    loadSystemInstruction,
    buildTenantSystemInstruction,
} from './client.js';
