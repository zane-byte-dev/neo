/**
 * src/llm/index.ts — Public API of the LLM module.
 *
 * Import from here in new code:
 *   import { LLMClient, resolveModel } from '../llm/index.js';
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

// Gemini standalone utilities (file upload, simple generation)
export {
    resolveModel,
    geminiGenerate,
    geminiUploadFile,
} from './providers/gemini/index.js';

// AI SDK tool bridge
export { buildAiTools } from './ai-tools.js';

// Client
export {
    LLMClient,
    createLLMClient,
    registerTool,
    getToolRegistry,
    loadSystemInstruction,
    buildTenantSystemInstruction,
} from './client.js';
