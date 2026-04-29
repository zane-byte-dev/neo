/**
 * src/llm/types.ts — Core type definitions for the LLM subsystem.
 */

// ── Stream types ─────────────────────────────────────────────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string; args?: Record<string, unknown> }
    | {
          type: 'tool_result';
          toolName: string;
          /** Preview (smart-truncated); full payload may be fetched via `resultId`. */
          result?: string;
          /** Cache key — pass to `GET /api/tool-result/:id` to retrieve the full payload. */
          resultId?: string;
          /** True when `result` is a truncated preview rather than the full text. */
          truncated?: boolean;
      }
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
    /** Project root exposed to general file/search/shell tools (may differ from homeWorkDir per session). */
    workDir: string;
    /**
     * The user's configured home/default workDir. Equals `workDir` unless the
     * session has overridden the project root. Used to gate auto-commit so
     * external project paths are not silently committed.
     */
    homeWorkDir?: string;
    /** Runtime state root for chat history, runs, memory, usage, etc. */
    stateDir: string;
    systemInstruction: string;
    /** Abort signal — fires when the client disconnects */
    signal?: AbortSignal;
    imageCallback?: (data: string, mimeType: string, caption?: string) => Promise<void>;
    /** Callback to push a video URL to the client */
    videoCallback?: (url: string) => Promise<void>;
    /** Callback to push real-time todo updates to the client */
    todoCallback?: (todos: { id: number; title: string; status: string }[]) => void;
    skillRegistry?: import('../skills/skill-registry.js').SkillRegistry;
    /** Per-user tools loaded from .tools/ directory */
    userTools?: Map<string, Tool>;
    /** Agent operating mode: 'plan' restricts write tools */
    mode?: 'normal' | 'plan';
    /**
     * Confirmation hook for dangerous-tier tools.
     * When provided, the executor calls it before running any tool whose
     * permission tier is 'dangerous'. If it resolves to `false`, execution
     * is aborted and the tool returns a [DENIED] message. When omitted,
     * dangerous tools run without prompting (legacy behaviour).
     */
    confirmCallback?: (req: { toolName: string; args: Record<string, unknown> }) => Promise<boolean>;
}

// ── Tool registration types ───────────────────────────────────────────────────

/**
 * Permission tier for a tool.
 *   - read      : pure reads (files, web, listings). Allowed in plan mode.
 *   - write     : mutates workspace (write_file, edit_file, save_memory).
 *   - dangerous : arbitrary side-effects / code execution (bash, subagent).
 *                 May require user confirmation.
 */
export type ToolPermission = 'read' | 'write' | 'dangerous';

export interface ToolMeta {
    /** Logical grouping for display / dynamic loading */
    category?: 'web' | 'ai' | 'utility' | 'knowledge' | 'workspace';
    /** Semver or date stamp, e.g. "1.0.0" */
    version?: string;
    /** Set to false to skip registration at startup (default: true) */
    enabled?: boolean;
    /** Env-var names that must be set for this tool to work, e.g. ['GEMINI_API_KEY'] */
    requiresEnv?: string[];
    /** Permission tier — defaults to 'write' when omitted (safe default) */
    permission?: ToolPermission;
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
