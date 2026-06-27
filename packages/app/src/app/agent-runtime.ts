/**
 * Neo app adapter for the runtime-facing AgentRuntime contract.
 *
 * This layer is intentionally allowed to depend on services, routes can depend
 * on this layer, and runtime core must not depend on it. It proves the future
 * package boundary without moving the whole app at once.
 */

import { runAgentTurn, resumeRun as resumeAgentRun } from '@neo/agent/services/agent-runner.js';
import { calcUser } from '@neo/agent/services/user-service.js';
import { fileRuntimeStore, newRunId, type AgentRuntime, type EventCursorOptions, type JsonObject, type ResumeRunInput, type RunResult, type RuntimeStore, type StartRunInput } from '@neo/runtime';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);

async function stateDirForUser(userId: string): Promise<string> {
    const userCtx = await calcUser(userId);
    return userCtx.stateDir ?? userCtx.workDir;
}

async function loadOwnedRun(store: RuntimeStore, userId: string, runId: string) {
    const stateDir = await stateDirForUser(userId);
    const run = await store.loadRun(stateDir, runId);
    if (!run) throw Object.assign(new Error('Run not found'), { code: 'not_found' });
    if (run.userId !== userId) throw Object.assign(new Error('Forbidden'), { code: 'forbidden' });
    return { stateDir, run };
}

export class NeoAgentRuntime implements AgentRuntime {
    constructor(private readonly store: RuntimeStore = fileRuntimeStore) {}

    async startRun(input: StartRunInput): Promise<RunResult> {
        const runId = input.runId ?? newRunId();
        const output = await runAgentTurn({ ...input, runId, runtimeStore: this.store });
        return { runId, output };
    }

    async resumeRun(input: ResumeRunInput): Promise<RunResult> {
        const output = await resumeAgentRun({ ...input, runtimeStore: this.store });
        return { runId: input.runId, output };
    }

    async cancelRun(userId: string, runId: string): Promise<{ ok: true; alreadyTerminal?: true; status: string }> {
        const { stateDir, run } = await loadOwnedRun(this.store, userId, runId);
        if (TERMINAL_STATUSES.has(run.status)) {
            return { ok: true, alreadyTerminal: true, status: run.status };
        }
        const metadata: JsonObject = { ...(run.metadata ?? {}), cancelRequested: true };
        await this.store.saveRun(stateDir, { ...run, metadata });
        return { ok: true, status: 'cancel_requested' };
    }

    async events(userId: string, runId: string, opts: EventCursorOptions = {}): Promise<{
        events: Awaited<ReturnType<RuntimeStore['listRunEvents']>>;
        nextCursor: number;
    }> {
        const { stateDir } = await loadOwnedRun(this.store, userId, runId);
        const cursor = opts.afterIndex ?? -1;
        const events = await this.store.listRunEvents(stateDir, runId, {
            afterIndex: cursor,
            ...(opts.limit !== undefined && { limit: opts.limit }),
        });
        return {
            events,
            nextCursor: events.length > 0 ? events[events.length - 1].index : cursor,
        };
    }
}

export const neoAgentRuntime = new NeoAgentRuntime();
