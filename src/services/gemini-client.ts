/**
 * gemini-client.ts — @deprecated Backward-compat re-export shim.
 * Import from 'src/llm/index.js' or 'src/llm/client.js' in new code.
 */
export {
    LLMClient as GeminiClient,
    LLMClient,
    createLLMClient as createGeminiClient,
    createLLMClient,
    registerTool,
    getToolRegistry,
    loadSystemInstruction,
    buildTenantSystemInstruction,
    geminiGenerate,
    geminiUploadFile,
} from '../llm/client.js';

export type {
    StreamChunk,
    StreamCallback,
    GeminiPart,
    ImageInput,
    FileInput,
    GeminiContent,
    FunctionDeclaration,
    ToolMeta,
    Tool,
    ToolContext,
} from '../llm/types.js';
