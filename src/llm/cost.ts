import { mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseJsonLines } from '../utils/json.js';

function usageFile(workDir: string): string {
    return join(workDir, 'usage.jsonl');
}

export const COST_PER_1K: Record<string, { input: number; output: number }> = {
    'deepseek-chat': { input: 0.00014, output: 0.00028 },
    'deepseek-reasoner': { input: 0.00055, output: 0.0022 },
};

export interface UsageRecord {
    timestamp: number;
    userId: string;
    model: string;
    tier: string;
    score: number;
    confidence: number;
    reason: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
    durationMs: number;
    fallbackUsed: boolean;
    originalModel?: string;
    sessionId?: string;
    caller?: string;
    systemPrompt?: string;
    userPrompt?: string;
}

function toDateKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = COST_PER_1K[model];
    if (!pricing) return 0;
    const inCost = (promptTokens / 1000) * pricing.input;
    const outCost = (completionTokens / 1000) * pricing.output;
    return inCost + outCost;
}

export async function appendUsageRecord(record: UsageRecord, workDir: string): Promise<void> {
    const file = usageFile(workDir);
    mkdirSync(workDir, { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function getDailyCost(workDir: string, dateKey = toDateKey(Date.now())): Promise<number> {
    let content = '';
    try {
        content = await readFile(usageFile(workDir), 'utf8');
    } catch {
        return 0;
    }
    let total = 0;
    for (const row of parseJsonLines<UsageRecord>(content)) {
        if (toDateKey(row.timestamp) === dateKey) total += row.estimatedCost;
    }
    return total;
}
