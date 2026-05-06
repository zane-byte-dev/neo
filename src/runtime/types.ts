/**
 * src/runtime/types.ts — Stable schema for recoverable agent runs.
 *
 * These types intentionally model the on-disk JSON shape first so the
 * runtime store, event log, resume flow, and external API can share the
 * same contract from day one.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
    [key: string]: JsonValue;
}

export const RUNTIME_LAYOUT = {
    runsDir: 'runs',
    runFile: 'run.json',
    eventsFile: 'events.jsonl',
    checkpointFile: 'checkpoint.json',
    pendingFile: 'pending.json',
    artifactsDir: 'artifacts',
} as const;

export const RUN_STATUS_VALUES = [
    'queued',
    'running',
    'waiting_confirm',
    'waiting_input',
    'completed',
    'failed',
    'cancelled',
    'expired',
] as const;

export type RunStatus = typeof RUN_STATUS_VALUES[number];

export const RUN_ENTRYPOINT_VALUES = [
    'web-chat',
    'cron',
    'telegram',
    'webhook',
    'system',
    'resume',
] as const;

export type RunEntrypoint = typeof RUN_ENTRYPOINT_VALUES[number];

export const RUN_TRIGGER_TYPE_VALUES = [
    'user_message',
    'scheduled_task',
    'telegram_message',
    'webhook_call',
    'system_task',
    'resume',
] as const;

export type RunTriggerType = typeof RUN_TRIGGER_TYPE_VALUES[number];

export const RUN_PHASE_VALUES = [
    'preparing',
    'streaming',
    'waiting_confirm',
    'waiting_input',
    'finalizing',
] as const;

export type RunPhase = typeof RUN_PHASE_VALUES[number];

export const RUN_ARTIFACT_KIND_VALUES = [
    'image',
    'video',
    'file',
    'text',
    'json',
] as const;

export type RunArtifactKind = typeof RUN_ARTIFACT_KIND_VALUES[number];

export const PENDING_ACTION_TYPE_VALUES = [
    'tool_confirmation',
    'user_input',
] as const;

export type PendingActionType = typeof PENDING_ACTION_TYPE_VALUES[number];

export const PENDING_ACTION_STATUS_VALUES = [
    'pending',
    'approved',
    'denied',
    'submitted',
    'cancelled',
    'expired',
] as const;

export type PendingActionStatus = typeof PENDING_ACTION_STATUS_VALUES[number];

export const TOOL_APPROVAL_SCOPE_VALUES = [
    'once',
    'session',
    'always',
] as const;

export type ToolApprovalScope = typeof TOOL_APPROVAL_SCOPE_VALUES[number];

export const RUN_EVENT_TYPE_VALUES = [
    'run_created',
    'run_started',
    'route_resolved',
    'user_message_saved',
    'llm_chunk',
    'tool_call_started',
    'tool_call_finished',
    'todo_updated',
    'artifact_created',
    'confirm_requested',
    'confirm_resolved',
    'notebook_citations',
    'run_completed',
    'run_failed',
] as const;

export type RunEventType = typeof RUN_EVENT_TYPE_VALUES[number];

export interface RunRequestPayload {
    message?: string;
    model?: string;
    imageCount?: number;
    documentCount?: number;
    sourceIds?: string[];
    metadata?: JsonObject;
}

export interface RunErrorInfo {
    message: string;
    name?: string;
    stack?: string;
    code?: string;
}

export interface RunMetrics {
    toolCallCount?: number;
    fallbackCount?: number;
    waitingConfirmMs?: number;
    totalDurationMs?: number;
}

export interface RunTodoItem {
    id: number;
    title: string;
    status: 'not-started' | 'in-progress' | 'completed';
}

export interface RunArtifact {
    id: string;
    runId: string;
    kind: RunArtifactKind;
    createdAt: string;
    path?: string;
    url?: string;
    mimeType?: string;
    title?: string;
    metadata?: JsonObject;
}

export interface PendingAction {
    id: string;
    runId: string;
    type: PendingActionType;
    status: PendingActionStatus;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    requestedBy?: 'system' | 'user';
    request: JsonObject;
    resolution?: JsonObject;
}

export interface RunCheckpoint {
    runId: string;
    updatedAt: string;
    phase: RunPhase;
    historyCursor?: number;
    partialResponse?: string;
    activeToolName?: string;
    activeToolStep?: number;
    activeToolArgs?: JsonObject;
    metadata?: JsonObject;
}

export interface RunRecord {
    id: string;
    userId: string;
    status: RunStatus;
    entrypoint: RunEntrypoint;
    triggerType: RunTriggerType;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    sessionId?: string;
    notebook?: string;
    parentRunId?: string;
    pendingActionId?: string;
    request: RunRequestPayload;
    metrics?: RunMetrics;
    lastError?: RunErrorInfo;
    metadata?: JsonObject;
}

export interface RunEventBase<TType extends RunEventType, TPayload> {
    id: string;
    runId: string;
    index: number;
    type: TType;
    ts: string;
    payload: TPayload;
}

export type RunCreatedEvent = RunEventBase<'run_created', {
    status: RunStatus;
    entrypoint: RunEntrypoint;
    triggerType: RunTriggerType;
}>;

export type RunStartedEvent = RunEventBase<'run_started', {
    startedAt: string;
}>;

export type RouteResolvedEvent = RunEventBase<'route_resolved', {
    model: string;
    tier?: string;
    score?: number;
    confidence?: number;
    reason?: string;
    fallbackChain?: string[];
}>;

export type UserMessageSavedEvent = RunEventBase<'user_message_saved', {
    role: 'user' | 'assistant' | 'system';
    sessionId?: string;
    messageId?: number;
    contentLength?: number;
    contentPreview?: string;
}>;

export type LlmChunkEvent = RunEventBase<'llm_chunk', {
    chunkType: 'text' | 'thought' | 'tool_call' | 'tool_result' | 'done' | 'error';
    text?: string;
    toolName?: string;
    args?: JsonObject;
    resultId?: string;
    truncated?: boolean;
}>;

export type ToolCallStartedEvent = RunEventBase<'tool_call_started', {
    toolName: string;
    args?: JsonObject;
}>;

export type ToolCallFinishedEvent = RunEventBase<'tool_call_finished', {
    toolName: string;
    outcome: 'success' | 'blocked' | 'denied' | 'error';
    durationMs?: number;
    resultPreview?: string;
    resultId?: string;
}>;

export type TodoUpdatedEvent = RunEventBase<'todo_updated', {
    todos: RunTodoItem[];
}>;

export type ArtifactCreatedEvent = RunEventBase<'artifact_created', {
    artifact: RunArtifact;
}>;

export type ConfirmRequestedEvent = RunEventBase<'confirm_requested', {
    actionId: string;
    actionType: PendingActionType;
    toolName?: string;
    args?: JsonObject;
    expiresAt?: string;
}>;

export type ConfirmResolvedEvent = RunEventBase<'confirm_resolved', {
    actionId: string;
    status: PendingActionStatus;
    decidedBy: 'user' | 'system';
    reason?: string;
    approvalScope?: ToolApprovalScope;
}>;

export interface NotebookCitationPayload {
    n: number;
    sourceId: string;
    title: string;
    snippet?: string;
    chunkId?: string;
    charStart?: number;
    charEnd?: number;
}

export type NotebookCitationsEvent = RunEventBase<'notebook_citations', {
    citations: NotebookCitationPayload[];
}>;

export type RunCompletedEvent = RunEventBase<'run_completed', {
    finishedAt: string;
    responseLength?: number;
    outputPreview?: string;
}>;

export type RunFailedEvent = RunEventBase<'run_failed', {
    finishedAt: string;
    error: RunErrorInfo;
}>;

export type RunEvent =
    | RunCreatedEvent
    | RunStartedEvent
    | RouteResolvedEvent
    | UserMessageSavedEvent
    | LlmChunkEvent
    | ToolCallStartedEvent
    | ToolCallFinishedEvent
    | TodoUpdatedEvent
    | ArtifactCreatedEvent
    | ConfirmRequestedEvent
    | ConfirmResolvedEvent
    | NotebookCitationsEvent
    | RunCompletedEvent
    | RunFailedEvent;