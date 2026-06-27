/**
 * token-tracker.ts — Record and query LLM token usage.
 *
 * Stores per-call usage in logs/token-usage-YYYY-MM.jsonl.
 * Provides aggregation helpers for monthly totals per model.
 */

import { mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseJsonLines } from './json.js';

const LOG_DIR = join(process.cwd(), 'logs');
let dirReady = false;

export interface TokenUsageEntry {
    ts: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Which function triggered the call (e.g. 'generate', 'chatWithContextStreaming') */
    caller?: string;
}

export interface MonthlyUsageSummary {
    month: string;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    callCount: number;
    byModel: Record<string, {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        callCount: number;
    }>;
}

function ensureDir(): void {
    if (!dirReady) {
        mkdirSync(LOG_DIR, { recursive: true });
        dirReady = true;
    }
}

function getFilePath(date?: Date): string {
    const d = date ?? new Date();
    const month = d.toISOString().slice(0, 7); // YYYY-MM
    return join(LOG_DIR, `token-usage-${month}.jsonl`);
}

/**
 * Record a single LLM call's token usage.
 */
export function recordTokenUsage(entry: TokenUsageEntry): void {
    ensureDir();
    const line = JSON.stringify(entry) + '\n';
    appendFile(getFilePath(), line, 'utf8').catch(() => { /* never crash over logging */ });
}

/**
 * Read monthly usage summary. Defaults to current month.
 */
export async function getMonthlyUsage(month?: string): Promise<MonthlyUsageSummary> {
    const target = month ?? new Date().toISOString().slice(0, 7);
    const filePath = join(LOG_DIR, `token-usage-${target}.jsonl`);

    const summary: MonthlyUsageSummary = {
        month: target,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        callCount: 0,
        byModel: {},
    };

    let content: string;
    try {
        content = await readFile(filePath, 'utf8');
    } catch {
        return summary; // file doesn't exist yet
    }

    for (const entry of parseJsonLines<TokenUsageEntry>(content)) {
        summary.totalPromptTokens += entry.promptTokens;
        summary.totalCompletionTokens += entry.completionTokens;
        summary.totalTokens += entry.totalTokens;
        summary.callCount++;

        if (!summary.byModel[entry.model]) {
            summary.byModel[entry.model] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
        }
        const m = summary.byModel[entry.model];
        m.promptTokens += entry.promptTokens;
        m.completionTokens += entry.completionTokens;
        m.totalTokens += entry.totalTokens;
        m.callCount++;
    }

    return summary;
}
