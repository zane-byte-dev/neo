/**
 * Neo app adapter for the runtime-facing AgentRuntime contract.
 *
 * This layer is intentionally allowed to depend on services, routes can depend
 * on this layer, and runtime core must not depend on it. It proves the future
 * package boundary without moving the whole app at once.
 */

import { runAgentTurn, resumeRun as resumeAgentRun } from '../services/agent-runner.js';
import { calcUser } from '../services/user-service.js';
import { listRunEvents, loadRun, newRunId, saveRun, type AgentRuntime, type EventCursorOptions, type JsonObject, type ResumeRunInput, type RunResult, type StartRunInput } from '../runtime/index.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);

async function stateDirForUser(userId: string): Promise<string> {
    const userCtx = await calcUser(userId);
    return userCtx.stateDir ?? userCtx.workDir;
}

async function loadOwnedRun(userId: string, runId: string) {
    const stateDir = await stateDirForUser(userId);
    const run = await loadRun(stateDir, runId);
    if (!run) throw Object.assign(new Error('Run not found'), { code: 'not_found' });
    if (run.userId !== userId) throw Object.assign(new Error('Forbidden'), { code: 'forbidden' });
    return { stateDir, run };
}

export class NeoAgentRuntime implements AgentRuntime {
    async startRun(input: StartRunInput): Promise<RunResult> {
        const runId = input.runId ?? newRunId();
        const output = await runAgentTurn({ ...input, runId });
        return { runId, output };
    }

    async resumeRun(input: ResumeRunInput): Promise<RunResult> {
        const output = await resumeAgentRun(input);
        return { runId: input.runId, output };
    }

    async cancelRun(userId: string, runId: string): Promise<{ ok: true; alreadyTerminal?: true; status: string }> {
        const { stateDir, run } = await loadOwnedRun(userId, runId);
        if (TERMINAL_STATUSES.has(run.status)) {
            return { ok: true, alreadyTerminal: true, status: run.status };
        }
        const metadata: JsonObject = { ...(run.metadata ?? {}), cancelRequested: true };
        await saveRun(stateDir, { ...run, metadata });
        return { ok: true, status: 'cancel_requested' };
    }

    async events(userId: string, runId: string, opts: EventCursorOptions = {}): Promise<{
        events: Awaited<ReturnType<typeof listRunEvents>>;
        nextCursor: number;
    }> {
        const { stateDir } = await loadOwnedRun(userId, runId);
        const cursor = opts.afterIndex ?? -1;
        const events = await listRunEvents(stateDir, runId, {
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
