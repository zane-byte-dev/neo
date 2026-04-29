/**
 * tool-stats.ts — In-memory collector for tool call statistics.
 *
 * Tracks per-tool and aggregate metrics:
 *   - total calls, successes, errors, blocked
 *   - duration (count, total_ms, max_ms, avg_ms)
 *   - last called timestamp
 *
 * Stats live in memory only and reset on process restart. Exposed via
 * GET /api/tool-stats for inspection.
 */

export type Outcome = 'success' | 'error' | 'blocked';

export interface ToolStat {
    name: string;
    total: number;
    success: number;
    error: number;
    blocked: number;
    totalDurationMs: number;
    maxDurationMs: number;
    lastCalledAt: string | null;
}

function emptyStat(name: string): ToolStat {
    return {
        name,
        total: 0,
        success: 0,
        error: 0,
        blocked: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastCalledAt: null,
    };
}

const stats = new Map<string, ToolStat>();
const startedAt = new Date().toISOString();

export function recordToolCall(name: string, outcome: Outcome, durationMs: number): void {
    let stat = stats.get(name);
    if (!stat) {
        stat = emptyStat(name);
        stats.set(name, stat);
    }
    stat.total += 1;
    stat[outcome] += 1;
    stat.totalDurationMs += durationMs;
    if (durationMs > stat.maxDurationMs) stat.maxDurationMs = durationMs;
    stat.lastCalledAt = new Date().toISOString();
}

export interface ToolStatSummary extends ToolStat {
    avgDurationMs: number;
    successRate: number;
}

export interface ToolStatsSnapshot {
    startedAt: string;
    totalCalls: number;
    tools: ToolStatSummary[];
}

function summarize(stat: ToolStat): ToolStatSummary {
    return {
        ...stat,
        avgDurationMs: stat.total > 0 ? stat.totalDurationMs / stat.total : 0,
        successRate: stat.total > 0 ? stat.success / stat.total : 0,
    };
}

export function getToolStats(): ToolStatsSnapshot {
    const tools = [...stats.values()]
        .map(summarize)
        .sort((a, b) => b.total - a.total);
    const totalCalls = tools.reduce((sum, t) => sum + t.total, 0);
    return { startedAt, totalCalls, tools };
}

/** Reset all counters. Intended for tests. */
export function resetToolStats(): void {
    stats.clear();
}

/**
 * Classify a tool executor return string into an outcome.
 * Convention used by executor.ts: errors start with "[Error]" and
 * blocked dangerous commands start with "[BLOCKED]".
 */
export function classifyOutcome(result: string): Outcome {
    if (result.startsWith('[BLOCKED]')) return 'blocked';
    if (result.startsWith('[Error]')) return 'error';
    return 'success';
}
