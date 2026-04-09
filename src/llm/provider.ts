/**
 * src/llm/provider.ts — LLMProvider interface.
 *
 * Every LLM backend (Gemini, OpenAI, Anthropic, …) must implement this interface.
 * LLMClient uses it to delegate actual API calls without knowing which model is
 * under the hood.
 */

import type {
    GeminiContent,
    ImageInput,
    StreamCallback,
    Tool,
    ToolContext,
} from './types.js';

// ── Parameter bags ────────────────────────────────────────────────────────────

export interface AgentLoopParams {
    apiKey: string;
    model: string;
    systemInstruction: string;
    /** Initial message history in the provider's native wire format. */
    contents: GeminiContent[];
    workDir: string;
    toolRegistry: Map<string, Tool>;
    onChunk?: StreamCallback;
    imageInput?: ImageInput;
    signal?: AbortSignal;
    context?: ToolContext;
}

export interface GenerateParams {
    apiKey: string;
    /** Raw contents in the provider's wire format. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contents: any[];
    model?: string;
    generationConfig?: Record<string, unknown>;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface LLMProvider {
    /** Unique identifier for this provider, e.g. "gemini" or "openai". */
    readonly name: string;

    /**
     * Resolve a short alias (e.g. "flash") to the provider's canonical model
     * identifier (e.g. "gemini-2.0-flash").
     */
    resolveModel(alias: string): string;

    /**
     * Run the full agentic loop: stream response, handle tool calls, repeat.
     * Returns the final text once no more tool calls are requested.
     */
    agentLoop(params: AgentLoopParams): Promise<string>;

    /**
     * Single-shot (non-streaming) generation.
     * Returns the text of the first candidate, or null on failure.
     */
    generate(params: GenerateParams): Promise<string | null>;

    /**
     * Upload a binary file and return a provider-specific URI to reference
     * in subsequent generation calls.
     */
    uploadFile(apiKey: string, buffer: Buffer, mimeType: string): Promise<string>;
}
