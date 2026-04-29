/**
 * src/routes/model.ts — Model info, usage stats, and routing config API.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Router from '@koa/router';
import { MODEL_ALIASES, DAILY_COST_LIMIT } from '../config.js';
import { COST_PER_1K, getDailyCost, type UsageRecord } from '../llm/cost.js';
import { isModelAliasAvailable } from '../llm/model-router.js';
import { ROUTING_CONFIG, applyRoutingOverride, getDefaultRoutingConfig, type RoutingConfig } from '../llm/routing-config.js';
import { saveRoutingOverrides, resetRoutingOverrides } from '../llm/routing-store.js';
import { getAllProviderStatus, type ProviderStatus } from '../llm/provider-status.js';
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
    tiers: string[];
    configured: boolean;
}

function resolveProvider(modelId: string): string {
    if (modelId.startsWith('gemini')) return 'google';
    if (modelId.startsWith('acp/')) return 'gemini-acp';
    if (modelId.startsWith('deepseek')) return 'deepseek';
    if (modelId.startsWith('ollama/')) return 'ollama';
    if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-')) return 'openai';
    if (modelId.startsWith('claude-')) return 'anthropic';
    return 'unknown';
}

function buildModelList(providerStatus: ProviderStatus[]): ModelInfo[] {
    const seen = new Set<string>();
    const list: ModelInfo[] = [];
    const statusByProvider = new Map(providerStatus.map((s) => [s.provider, s]));
    for (const [alias, modelId] of Object.entries(MODEL_ALIASES)) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        const pricing = COST_PER_1K[modelId] ?? { input: 0, output: 0 };
        const tiers: string[] = [];
        for (const [tier, models] of Object.entries(ROUTING_CONFIG.tiers)) {
            if ((models as string[]).includes(alias)) tiers.push(tier);
        }
        const provider = resolveProvider(modelId);
        // For Ollama models, "configured" requires the daemon to be reachable.
        // For Gemini ACP, "configured" requires the gemini CLI binary to be present.
        let configured = isModelAliasAvailable(alias);
        if (provider === 'ollama') configured = configured && Boolean(statusByProvider.get('ollama')?.ok);
        if (provider === 'gemini-acp') configured = Boolean(statusByProvider.get('gemini-acp')?.ok);
        list.push({
            alias,
            modelId,
            provider,
            pricing,
            free: pricing.input === 0 && pricing.output === 0,
            tiers,
            configured,
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

function snapshotRouting() {
    return {
        tiers: ROUTING_CONFIG.tiers,
        boundaries: ROUTING_CONFIG.boundaries,
        overrides: ROUTING_CONFIG.overrides,
        momentum: ROUTING_CONFIG.momentum,
        confidence: ROUTING_CONFIG.confidence,
    };
}

// ── route ────────────────────────────────────────────────────────────────────

export function model(router: Router): void {
    /**
     * GET /api/models — Overview of all available models, routing config,
     * usage stats, and recent history in one call.
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

        const [usage, history, dailyCost, providerStatus] = await Promise.all([
            getMonthlyUsage(month),
            loadUsageRecords(effectiveStateDir, limit),
            getDailyCost(effectiveStateDir),
            getAllProviderStatus(),
        ]);

        ctx.body = {
            models: buildModelList(providerStatus),
            providerStatus,
            routing: snapshotRouting(),
            routingDefaults: getDefaultRoutingConfig(),
            usage,
            history,
            dailyCost,
            dailyCostLimit: DAILY_COST_LIMIT,
        };
    });

    /**
     * PUT /api/models/routing — Update routing overrides (deep-merge).
     * Body: Partial<RoutingConfig>
     */
    router.put('/api/models/routing', async (ctx) => {
        const body = (ctx.request.body ?? {}) as Partial<RoutingConfig>;
        try {
            await saveRoutingOverrides(body);
        } catch (err) {
            ctx.status = 400;
            ctx.body = { error: (err as Error).message };
            return;
        }
        ctx.body = { ok: true, routing: snapshotRouting() };
    });

    /**
     * POST /api/models/routing/reset — Reset routing config back to defaults.
     */
    router.post('/api/models/routing/reset', async (ctx) => {
        try {
            await resetRoutingOverrides();
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: (err as Error).message };
            return;
        }
        ctx.body = { ok: true, routing: snapshotRouting() };
    });

    /**
     * GET /api/models/messages?sessionId=xxx — Fetch messages for a session (debug).
     * Returns the most recent messages around the LLM call for inspection.
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
