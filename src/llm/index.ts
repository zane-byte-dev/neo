/**
 * src/llm/index.ts — Public API of the LLM module.
 *
 * Import from here in new code:
 *   import { LLMClient, LLMProvider, GeminiProvider } from '../llm/index.js';
 */

// Core types
export type {
    StreamChunk,
    StreamCallback,
    ImageInput,
    FileInput,
    GeminiPart,
    GeminiContent,
    FunctionDeclaration,
    ToolMeta,
    Tool,
    ToolContext,
} from './types.js';

// Provider interface + param types
export type { LLMProvider, AgentLoopParams, GenerateParams } from './provider.js';

// Gemini provider + standalone functions
export {
    GeminiProvider,
    resolveModel,
    agentLoop,
    geminiGenerate,
    geminiUploadFile,
} from './providers/gemini/index.js';

// Client
export {
    LLMClient,
    createLLMClient,
    registerTool,
    getToolRegistry,
    loadSystemInstruction,
    buildTenantSystemInstruction,
} from './client.js';
