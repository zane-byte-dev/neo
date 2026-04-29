import type Router from '@koa/router';
import { sessionCreate, sessionList, sessionPatch, sessionDelete, messageList } from '../services/chat-service.js';
import { calcUser } from '../services/user-service.js';
import { listRunIds, loadRun } from '../runtime/store.js';
import { listRunEvents } from '../runtime/events.js';
import type { RunEvent, ToolApprovalScope } from '../runtime/types.js';

interface ActivityItemResponse {
    type: 'tool_call' | 'tool_result' | 'tool_confirm';
    toolName: string;
    args?: Record<string, unknown>;
    result?: string;
    resultId?: string;
    truncated?: boolean;
    confirmId?: string;
    runId?: string;
    actionId?: string;
    confirmStatus?: 'pending' | 'approved' | 'denied' | 'submitted' | 'cancelled' | 'expired';
    approvalScope?: ToolApprovalScope;
    timestamp: number;
}

interface TextPartResponse {
    type: 'text';
    content: string;
}

interface ActivityPartResponse {
    type: 'activity';
    item: ActivityItemResponse;
}

type MessagePartResponse = TextPartResponse | ActivityPartResponse;

interface SessionMessageResponse {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    activityLog?: ActivityItemResponse[];
    parts?: MessagePartResponse[];
}

interface SessionRunActivity {
    contentPreview?: string;
    contentLength?: number;
    savedAt?: number;
    activityLog: ActivityItemResponse[];
}

export function newSession(router: Router): void {
    router.post('/api/session/clear', async (ctx: import('koa').Context) => {
        const reqUserId: string | undefined = ctx.state.userId;
        if (reqUserId) {
            await sessionCreate(reqUserId);
        }
        ctx.body = { ok: true };
    });

    router.get('/api/sessions', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const rows = await sessionList(userId);
        ctx.body = rows.map((s) => ({
            id: s.id,
            title: s.title || 'New Chat',
            isPinned: s.is_pinned === 1,
            createdAt: new Date(s.start_time).getTime(),
        }));
    });

    router.patch('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const body = ctx.request.body as Record<string, unknown>;
        const patch: { title?: string; is_pinned?: number } = {};
        if (typeof body.title === 'string') patch.title = body.title;
        if (typeof body.isPinned === 'boolean') patch.is_pinned = body.isPinned ? 1 : 0;
        const updated = await sessionPatch(id, userId, patch);
        if (!updated) { ctx.status = 404; ctx.body = { error: 'Not found' }; return; }
        ctx.body = { ok: true };
    });

    router.delete('/api/sessions/:id', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) { ctx.status = 401; ctx.body = { error: 'Unauthorized' }; return; }
        const { id } = ctx.params;
        const ok = await sessionDelete(id, userId);
        ctx.body = { ok };
    });

    router.get('/api/messages', async (ctx: import('koa').Context) => {
        const userId: string | undefined = ctx.state.userId;
        if (!userId) {
            ctx.status = 401;
            ctx.body = { error: 'Unauthorized' };
            return;
        }
        const sessionId = ctx.query.sessionId as string | undefined;
        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }
        const rows = await messageList(sessionId, userId);
        ctx.body = await buildSessionMessagesResponse(userId, sessionId, rows);
    });
}

async function buildSessionMessagesResponse(
    userId: string,
    sessionId: string,
    rows: Awaited<ReturnType<typeof messageList>>,
): Promise<SessionMessageResponse[]> {
    const runActivities = await loadSessionRunActivities(userId, sessionId);
    const unmatchedActivities = [...runActivities];

    return rows.map((row) => {
        const base: SessionMessageResponse = {
            id: String(row.id),
            role: (row.role === 'model' ? 'assistant' : row.role) as 'user' | 'assistant',
            content: row.content,
            timestamp: new Date(row.timestamp).getTime(),
        };
        if (base.role !== 'assistant') return base;

        const matched = takeMatchingRunActivity(base, unmatchedActivities);
        if (!matched || matched.activityLog.length === 0) return base;

        return {
            ...base,
            activityLog: matched.activityLog,
            parts: [
                ...matched.activityLog.map((item) => ({ type: 'activity', item }) satisfies ActivityPartResponse),
                ...(base.content ? [{ type: 'text', content: base.content } satisfies TextPartResponse] : []),
            ],
        };
    });
}

async function loadSessionRunActivities(userId: string, sessionId: string): Promise<SessionRunActivity[]> {
    const userCtx = await calcUser(userId);
    const stateDir = userCtx.stateDir ?? userCtx.workDir;
    const ids = listRunIds(stateDir);
    const runs = await Promise.all(ids.map((id) => loadRun(stateDir, id)));
    const relevantRuns = runs
        .filter((run): run is NonNullable<typeof run> => run !== null && run.userId === userId && run.sessionId === sessionId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    const activities: SessionRunActivity[] = [];
    for (const run of relevantRuns) {
        const events = await listRunEvents(stateDir, run.id);
        const activity = buildRunActivity(run.id, events);
        if (activity && activity.activityLog.length > 0) {
            activities.push(activity);
        }
    }
    return activities;
}

function buildRunActivity(runId: string, events: RunEvent[]): SessionRunActivity | null {
    const activityLog: ActivityItemResponse[] = [];
    const pendingToolResults = new Map<string, { resultId?: string; truncated?: boolean }>();
    let contentPreview: string | undefined;
    let contentLength: number | undefined;
    let savedAt: number | undefined;

    for (const event of events) {
        switch (event.type) {
            case 'llm_chunk': {
                if (event.payload.chunkType !== 'tool_result') break;
                pendingToolResults.set(toolResultKey(event.payload.toolName, event.payload.resultId), {
                    resultId: event.payload.resultId,
                    truncated: event.payload.truncated,
                });
                break;
            }
            case 'tool_call_started': {
                activityLog.push({
                    type: 'tool_call',
                    toolName: event.payload.toolName,
                    args: asRecord(event.payload.args),
                    timestamp: Date.parse(event.ts),
                });
                break;
            }
            case 'confirm_requested': {
                const nextItem: ActivityItemResponse = {
                    type: 'tool_confirm',
                    toolName: event.payload.toolName ?? 'tool',
                    args: asRecord(event.payload.args),
                    confirmId: event.payload.actionId,
                    actionId: event.payload.actionId,
                    runId,
                    confirmStatus: 'pending',
                    timestamp: Date.parse(event.ts),
                };
                const last = activityLog[activityLog.length - 1];
                if (
                    last?.type === 'tool_call'
                    && last.toolName === nextItem.toolName
                    && sameArgs(last.args, nextItem.args)
                ) {
                    activityLog[activityLog.length - 1] = nextItem;
                } else {
                    activityLog.push(nextItem);
                }
                break;
            }
            case 'confirm_resolved': {
                const idx = activityLog.findIndex((item) => item.type === 'tool_confirm' && item.confirmId === event.payload.actionId);
                if (idx >= 0) {
                    activityLog[idx] = {
                        ...activityLog[idx],
                        confirmStatus: event.payload.status,
                        ...(event.payload.approvalScope ? { approvalScope: event.payload.approvalScope } : {}),
                    };
                }
                break;
            }
            case 'tool_call_finished': {
                const pending = pendingToolResults.get(toolResultKey(event.payload.toolName, event.payload.resultId));
                pendingToolResults.delete(toolResultKey(event.payload.toolName, event.payload.resultId));
                activityLog.push({
                    type: 'tool_result',
                    toolName: event.payload.toolName,
                    result: event.payload.resultPreview,
                    resultId: pending?.resultId ?? event.payload.resultId,
                    truncated: pending?.truncated,
                    timestamp: Date.parse(event.ts),
                });
                break;
            }
            case 'user_message_saved': {
                if (event.payload.role !== 'assistant') break;
                contentPreview = event.payload.contentPreview;
                contentLength = event.payload.contentLength;
                savedAt = Date.parse(event.ts);
                break;
            }
            default:
                break;
        }
    }

    if (activityLog.length === 0) return null;
    return { contentPreview, contentLength, savedAt, activityLog };
}

function takeMatchingRunActivity(
    row: Pick<SessionMessageResponse, 'content' | 'timestamp'>,
    histories: SessionRunActivity[],
): SessionRunActivity | undefined {
    let bestIndex = -1;
    let bestScore = -1;

    for (let idx = 0; idx < histories.length; idx += 1) {
        const score = scoreRunActivityMatch(row, histories[idx]);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = idx;
        }
    }

    if (bestIndex < 0 || bestScore <= 0) return undefined;
    return histories.splice(bestIndex, 1)[0];
}

function scoreRunActivityMatch(
    row: Pick<SessionMessageResponse, 'content' | 'timestamp'>,
    history: SessionRunActivity,
): number {
    let score = 0;
    if (history.contentPreview && row.content.startsWith(history.contentPreview)) score += 4;
    if (typeof history.contentLength === 'number' && history.contentLength === row.content.length) score += 2;
    if (typeof history.savedAt === 'number') {
        const diff = Math.abs(row.timestamp - history.savedAt);
        if (diff <= 5_000) score += 2;
        else if (diff <= 60_000) score += 1;
    }
    return score;
}

function toolResultKey(toolName: string | undefined, resultId: string | undefined): string {
    return resultId ? `id:${resultId}` : `tool:${toolName ?? 'unknown'}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function sameArgs(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}



