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
    profile?: string;
    notebook?: string;
    parentRunId?: string;
    metadata?: import('./types.js').JsonObject;
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

export interface RuntimeStore {
    createRun(
        stateDir: string,
        input: import('./store.js').CreateRunInput,
    ): Promise<import('./types.js').RunRecord>;
    listRunIds(stateDir: string): string[];
    loadRun(stateDir: string, runId: string): Promise<import('./types.js').RunRecord | null>;
    saveRun(stateDir: string, run: import('./types.js').RunRecord): Promise<import('./types.js').RunRecord>;
    updateRunStatus(
        stateDir: string,
        runId: string,
        status: import('./types.js').RunStatus,
        extra?: Partial<Pick<import('./types.js').RunRecord, 'lastError' | 'metrics' | 'pendingActionId' | 'metadata'>>,
    ): Promise<import('./types.js').RunRecord | null>;
    appendRunEvent(
        stateDir: string,
        runId: string,
        type: import('./types.js').RunEventType,
        payload: import('./types.js').RunEvent['payload'],
        opts?: import('./events.js').AppendEventOptions,
    ): Promise<import('./types.js').RunEvent>;
    listRunEvents(
        stateDir: string,
        runId: string,
        opts?: EventCursorOptions,
    ): Promise<import('./types.js').RunEvent[]>;
    lastRunEventIndex(stateDir: string, runId: string): Promise<number>;
    pruneRunTextChunkEvents(stateDir: string, runId: string): Promise<void>;
    loadCheckpoint(stateDir: string, runId: string): Promise<import('./types.js').RunCheckpoint | null>;
    saveCheckpoint(
        stateDir: string,
        checkpoint: import('./types.js').RunCheckpoint,
    ): Promise<import('./types.js').RunCheckpoint>;
    deleteCheckpoint(stateDir: string, runId: string): Promise<void>;
    savePendingAction(
        stateDir: string,
        input: import('./pending-actions.js').CreatePendingActionInput,
    ): Promise<import('./types.js').PendingAction>;
    loadPendingAction(stateDir: string, runId: string): Promise<import('./types.js').PendingAction | null>;
    resolvePendingAction(
        stateDir: string,
        input: import('./pending-actions.js').ResolvePendingActionInput,
    ): Promise<import('./types.js').PendingAction | null>;
    expirePendingAction(
        stateDir: string,
        runId: string,
        now?: Date,
    ): Promise<import('./types.js').PendingAction | null>;
    clearPendingAction(stateDir: string, runId: string): Promise<void>;
    matchToolApprovalScope(
        stateDir: string,
        input: import('./tool-approvals.js').MatchApprovalInput,
    ): Promise<Exclude<import('./types.js').ToolApprovalScope, 'once'> | null>;
    saveToolApproval(
        stateDir: string,
        input: import('./tool-approvals.js').SaveApprovalInput,
    ): Promise<Exclude<import('./types.js').ToolApprovalScope, 'once'>>;
    listToolApprovals(stateDir: string): Promise<import('./tool-approvals.js').ToolApprovalRule[]>;
    deleteToolApproval(stateDir: string, ruleId: string): Promise<boolean>;
}
