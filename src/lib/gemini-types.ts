/**
 * gemini-types.ts — Shared type definitions for the Gemini agent system.
 */

// ── Stream types ─────────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string }
    | { type: 'text'; text: string };

export type StreamCallback = (chunk: StreamChunk) => void;

// Kept so existing callers (chatAsyncWithContext signature) still compile.
export interface JSONRPCNotification {
    jsonrpc: '2.0';
    method: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any;
}

// ── Gemini REST API types ─────────────────────────────────────────────────────

export type GeminiPart =
    | { text: string; thought?: boolean }
    | { functionCall: { name: string; args: Record<string, unknown>; thought_signature?: string } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { mimeType: string; fileUri: string } };

/** Image payload passed to the agent for vision tasks. */
export type ImageInput =
    | { type: 'inline'; mimeType: string; data: string }       // base64
    | { type: 'fileUri'; mimeType: string; fileUri: string };  // Gemini File API

/** Generic file attachment — same structure as ImageInput, covers PDF/audio/video too. */
export type FileInput = ImageInput;

export interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required?: string[];
    };
}

// ── Skill types ──────────────────────────────────────────────────────────────

export interface SkillMeta {
    /** Logical grouping for display / dynamic loading */
    category?: 'web' | 'ai' | 'utility' | 'knowledge';
    /** Semver or date stamp, e.g. "1.0.0" */
    version?: string;
    /** Set to false to skip registration at startup (default: true) */
    enabled?: boolean;
    /** Env-var names that must be set for this skill to work, e.g. ['GEMINI_API_KEY'] */
    requiresEnv?: string[];
}

export interface Skill {
    declaration: FunctionDeclaration;
    handler: (args: Record<string, unknown>, workDir: string) => Promise<string>;
    /** Optional metadata — compatible with MCP tool-manifest conventions */
    meta?: SkillMeta;
}
