/**
 * Runtime-facing contracts shared by app adapters and executor adapters.
 *
 * Keep these interfaces free of Koa, React, SSE, and concrete Notebook /
 * Memory / Skill implementations. They are the first internal boundary for a
 * future @neo/runtime package.
 */

export interface RuntimeToolCallRequest {
    name: string;
    args: Record<string, unknown>;
    workDir: string;
    /**
     * Adapter-specific context. The current app passes the existing ToolContext;
     * runtime contracts intentionally do not depend on that concrete type.
     */
    context?: unknown;
}

/**
 * Runtime-owned tool execution boundary.
 *
 * Agent executors request tool calls; the runtime decides permission,
 * approval, sandboxing, cwd, result caching, and event emission.
 */
export interface ToolExecutor {
    execute(request: RuntimeToolCallRequest): Promise<string>;
}

export interface EventCursorOptions {
    afterIndex?: number;
    limit?: number;
}

export interface RunHandle {
    runId: string;
}

export interface ApprovalDecision {
    runId: string;
    actionId: string;
    approved: boolean;
    reason?: string;
}

export interface RuntimeArtifactResult {
    path?: string;
    url?: string;
    mimeType?: string;
    title?: string;
    metadata?: import('./types.js').JsonObject;
}

export interface StartRunInput {
    userId: string;
    sessionId: string;
    message: string;
    runId?: string;
    entrypoint?: import('./types.js').RunEntrypoint;
    triggerType?: import('./types.js').RunTriggerType;
    model?: string;
    images?: string[];
    signal?: AbortSignal;
    confirmCallback?: (req: { toolName: string; args: Record<string, unknown> }) => Promise<boolean>;
    onImage?: (data: string, mimeType: string, caption?: string) => Promise<RuntimeArtifactResult | void>;
    onVideo?: (url: string) => Promise<RuntimeArtifactResult | void>;
    onTodo?: (todos: { id: number; title: string; status: string }[]) => void;
}

export interface ResumeRunInput {
    userId: string;
    runId: string;
    signal?: AbortSignal;
    confirmCallback?: StartRunInput['confirmCallback'];
    onImage?: StartRunInput['onImage'];
    onVideo?: StartRunInput['onVideo'];
    onTodo?: StartRunInput['onTodo'];
}

export interface RunResult extends RunHandle {
    output: string;
}

export interface AgentRuntime {
    startRun(input: StartRunInput): Promise<RunResult>;
    resumeRun(input: ResumeRunInput): Promise<RunResult>;
    cancelRun(userId: string, runId: string): Promise<{ ok: true; alreadyTerminal?: true; status: string }>;
    events(userId: string, runId: string, opts?: EventCursorOptions): Promise<{
        events: import('./types.js').RunEvent[];
        nextCursor: number;
    }>;
}
