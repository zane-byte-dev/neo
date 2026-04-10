/**
 * src/llm/types.ts — Provider-agnostic type definitions for the LLM subsystem.
 *
 * These types are shared across all LLM providers (Gemini, OpenAI, …).
 */

// ── Stream types ─────────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string; args?: Record<string, unknown> }
    | { type: 'text'; text: string };

export type StreamCallback = (chunk: StreamChunk) => void;

// ── Input attachment types ────────────────────────────────────────────────────

/** Image payload passed to the agent for vision tasks. */
export type ImageInput =
    | { type: 'inline'; mimeType: string; data: string }       // base64
    | { type: 'fileUri'; mimeType: string; fileUri: string };  // File API reference

/** Generic file attachment — same structure as ImageInput, covers PDF/audio/video too. */
export type FileInput = ImageInput;

// ── Wire-format types (kept for backward compat; Gemini-specific names) ───────
//
// These represent the Gemini REST API message format.  They live here because
// essentially every part of the app that talks to a tool or builds history uses
// them.  When a second provider is added, introduce a normalised LLMMessage and
// translate at the provider boundary.

export type GeminiPart =
    | { text: string; thought?: boolean }
    | { functionCall: { name: string; args: Record<string, unknown>; thought_signature?: string } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { mimeType: string; fileUri: string } };

export interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

// ── Tool / function-calling types ─────────────────────────────────────────────

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }>;
        required?: string[];
    };
}

// ── Tool context (fields available to tools at runtime) ──────────────────────

export interface ToolContext {
    /** Tenant key (platform:userId) for platform routing */
    tenantKey: string;
    /** Resolved internal user ID (from users.json) — shared across all tenants of the same user */
    userId: string;
    /** Platform-specific chat/channel ID */
    chatId: string;
    /** Per-tenant workspace root directory (absolute path) */
    workDir: string;
    /** Per-tenant system instruction (for sub-agent calls) */
    systemInstruction: string;
    /**
     * Web-only: stream a generated image back via SSE instead of using the platform adapter.
     * When present, generate_image will call this instead of adapter.sendPhoto().
     */
    imageCallback?: (data: string, mimeType: string, caption?: string) => Promise<void>;
    /**
     * Per-user skill registry — populated from space/{userId}/skills/*.skill.md.
     * Used by the run_skill tool to look up and execute Markdown-defined skills.
     */
    skillRegistry?: import('../skills/skill-registry.js').SkillRegistry;
}

// ── Tool registration types ───────────────────────────────────────────────────

export interface ToolMeta {
    /** Logical grouping for display / dynamic loading */
    category?: 'web' | 'ai' | 'utility' | 'knowledge' | 'workspace';
    /** Semver or date stamp, e.g. "1.0.0" */
    version?: string;
    /** Set to false to skip registration at startup (default: true) */
    enabled?: boolean;
    /** Env-var names that must be set for this tool to work, e.g. ['GEMINI_API_KEY'] */
    requiresEnv?: string[];
}

export interface Tool {
    declaration: FunctionDeclaration;
    handler: (args: Record<string, unknown>, workDir: string, context?: ToolContext) => Promise<string>;
    /** Optional metadata — compatible with MCP tool-manifest conventions */
    meta?: ToolMeta;
}
