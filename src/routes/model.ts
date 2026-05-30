/**
 * src/routes/model.ts — Model info and usage stats API.
 *
 * Simplified: only DeepSeek is advertised. No provider-status checks, no
 * routing-config editor endpoints.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Router from '@koa/router';
import { MODEL_ALIASES } from '../config.js';
import { COST_PER_1K, getDailyCost, type UsageRecord } from '../llm/cost.js';
import { parseJsonLines } from '../utils/json.js';
import { getMonthlyUsage } from '../utils/token-tracker.js';
import { messageList } from '../services/chat-service.js';
import { calcUser } from '../services/user-service.js';

// ── helpers ──────────────────────────────────────────────────────────────────

interface ModelInfo {
    alias: string;
    modelId: string;
    provider: string;
    pricing: { input: number; output: number };
    free: boolean;
    configured: boolean;
}

function resolveProvider(modelId: string): string {
    if (modelId.startsWith('deepseek')) return 'deepseek';
    return 'unknown';
}

function buildModelList(): ModelInfo[] {
    const seen = new Set<string>();
    const list: ModelInfo[] = [];
    for (const [alias, modelId] of Object.entries(MODEL_ALIASES)) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        const pricing = COST_PER_1K[modelId] ?? { input: 0, output: 0 };
        list.push({
            alias,
            modelId,
            provider: resolveProvider(modelId),
            pricing,
            free: pricing.input === 0 && pricing.output === 0,
            configured: true, // DeepSeek is the only model and always configured
        });
    }
    return list;
}

async function loadUsageRecords(workDir: string, limit: number): Promise<UsageRecord[]> {
    const filePath = join(workDir, 'usage.jsonl');
    let content: string;
    try {
        content = await readFile(filePath, 'utf8');
    } catch {
        return [];
    }
    return parseJsonLines<UsageRecord>(content).slice(-limit).reverse();
}

// ── route ────────────────────────────────────────────────────────────────────

export function model(router: Router): void {
    /**
     * GET /api/models — Overview of all available models, usage stats,
     * and recent history in one call.
     *
     * Query params:
     *   month   — YYYY-MM for token usage (default: current month)
     *   limit   — max history records to return (default: 50)
     */
    router.get('/api/models', async (ctx) => {
        const userId = ctx.state.userId as string;
        const { stateDir, workDir } = await calcUser(userId);
        const effectiveStateDir = stateDir ?? workDir;
        const month = (ctx.query.month as string) || undefined;
        const limit = Math.min(Number(ctx.query.limit) || 50, 200);

        const [usage, history, dailyCost] = await Promise.all([
            getMonthlyUsage(month),
            loadUsageRecords(effectiveStateDir, limit),
            getDailyCost(effectiveStateDir),
        ]);

        ctx.body = {
            models: buildModelList(),
            routing: { tiers: {} },
            usage,
            history,
            dailyCost,
        };
    });

    /**
     * GET /api/models/messages?sessionId=xxx — Fetch messages for a session (debug).
     */
    router.get('/api/models/messages', async (ctx) => {
        const sessionId = ctx.query.sessionId as string;
        const userId = ctx.state.userId as string;
        if (!sessionId) {
            ctx.status = 400;
            ctx.body = { error: 'sessionId is required' };
            return;
        }
        const messages = await messageList(sessionId, userId, 200);
        ctx.body = { messages };
    });
}
