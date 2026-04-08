/**
 * gemini-types.ts — Shared type definitions for the Gemini agent system.
 */

// ── Stream types ─────────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string; args?: Record<string, unknown> }
    | { type: 'text'; text: string };

export type StreamCallback = (chunk: StreamChunk) => void;

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
        properties: Record<string, { type: string; description: string; items?: { type: string }; enum?: string[] }>;
        required?: string[];
    };
}

// ── Tool context (fields available to tools at runtime) ──────────────────────

export interface ToolContext {
    /** Tenant key (platform:userId) for DB-scoped operations */
    tenantKey: string;
    /** Platform-specific chat/channel ID */
    chatId: string;
    /** Platform adapter for sending messages, photos, etc. */
    adapter: {
        sendMessage(chatId: string, text: string, opts?: Record<string, unknown>): Promise<{ id: string; chatId: string }>;
        sendPhoto(chatId: string, photo: string | Buffer, caption?: string): Promise<{ id: string; chatId: string }>;
    };
    /** Reminder manager instance */
    reminderManager: any;
    /** Scheduled task manager instance */
    scheduledTaskManager: any;
    /**
     * Web-only: stream a generated image back via SSE instead of using the platform adapter.
     * When present, generate_image will call this instead of adapter.sendPhoto().
     */
    imageCallback?: (data: string, mimeType: string, caption?: string) => Promise<void>;
}

// ── Tool types ───────────────────────────────────────────────────────────────

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
