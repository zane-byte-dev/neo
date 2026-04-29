import { mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tier } from './routing-config.js';
import { parseJsonLines } from '../utils/json.js';

function usageFile(workDir: string): string {
    return join(workDir,  'usage.jsonl');
}

export const COST_PER_1K: Record<string, { input: number; output: number }> = {
    'gemini-3-flash-preview': { input: 0.0, output: 0.0 },
    'acp/gemini': { input: 0.0, output: 0.0 },
    'deepseek-chat': { input: 0.00014, output: 0.00028 },
    'deepseek-reasoner': { input: 0.00055, output: 0.0022 },
    'ollama/gemma4:e4b': { input: 0.0, output: 0.0 },
    // OpenAI (USD per 1K tokens, Nov 2025 pricing)
    'gpt-4o':       { input: 0.0025,  output: 0.01   },
    'gpt-4o-mini':  { input: 0.00015, output: 0.0006 },
    'gpt-5':        { input: 0.00125, output: 0.01   },
    'gpt-5-mini':   { input: 0.00025, output: 0.002  },
    // Anthropic Claude (USD per 1K tokens)
    'claude-opus-4-5':   { input: 0.015,  output: 0.075 },
    'claude-sonnet-4-5': { input: 0.003,  output: 0.015 },
    'claude-haiku-4-5':  { input: 0.0008, output: 0.004 },
};

export interface UsageRecord {
    timestamp: number;
    userId: string;
    model: string;
    tier: Tier;
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
    /** The system instruction sent to the model (AGENTS.md + SOUL.md + USER.md etc.) */
    systemPrompt?: string;
    /** The full user prompt as actually sent to the model (with runtime context wrapping) */
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

export function isFreeModel(model: string): boolean {
    const pricing = COST_PER_1K[model];
    return !pricing || (pricing.input === 0 && pricing.output === 0);
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

