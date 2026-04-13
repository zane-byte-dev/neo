/**
 * src/llm/types.ts — Core type definitions for the LLM subsystem.
 */

// ── Stream types ─────────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string; args?: Record<string, unknown> }
    | { type: 'tool_result'; toolName: string; result?: string }
    | { type: 'text'; text: string };

export type StreamCallback = (chunk: StreamChunk) => void;

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
    userId: string;
    sessionId: string;
    workDir: string;
    systemInstruction: string;
    imageCallback?: (data: string, mimeType: string, caption?: string) => Promise<void>;
    /** Callback to push real-time todo updates to the client */
    todoCallback?: (todos: { id: number; title: string; status: string }[]) => void;
    skillRegistry?: import('../skills/skill-registry.js').SkillRegistry;
    /** Per-user tools loaded from .tools/ directory */
    userTools?: Map<string, Tool>;
    /** Agent operating mode: 'plan' restricts write tools */
    mode?: 'normal' | 'plan';
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
    meta?: ToolMeta;
}

export interface Tool {
    declaration: FunctionDeclaration;
    handler: (args: Record<string, unknown>, workDir: string, context?: ToolContext) => Promise<string>;
    /** Optional metadata — compatible with MCP tool-manifest conventions */
    meta?: ToolMeta;
}
