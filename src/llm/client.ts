/**
 * src/llm/client.ts — LLM client powered by Vercel AI SDK.
 *
 * Wraps AI SDK's streamText / generateText and exposes the same high-level
 * chat methods used throughout the application.  The tool registry, system
 * instruction loading, and prompt construction live here.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { streamText, generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { setupLogger, log } from '../utils/logger.js';
import { recordTokenUsage } from '../utils/token-tracker.js';
import { ANTHROPIC_API_KEY, DAILY_COST_LIMIT, DEEPSEEK_API_KEY, GEMINI_API_KEY, GEMINI_MODEL_ENV, GENERATE_TIMEOUT_MS, MAX_SUBAGENT_STEPS, MAX_TOOL_ITERATIONS, MODEL_ALIASES, OLLAMA_BASE_URL, OPENAI_API_KEY, STREAM_FIRST_CHUNK_TIMEOUT_MS } from '../config.js';
import { buildAiTools } from './ai-tools.js';
import { acpStream, acpGenerate } from './providers/gemini-acp.js';
import { appendUsageRecord, estimateCost, getDailyCost, isFreeModel } from './cost.js';
import { setToolResult, smartTruncate } from '../utils/tool-result-cache.js';
import { generateId } from '../utils/id-generator.js';
import { recall, renderHits } from '../memory/index.js';
import { buildBuiltinToolsGuide } from '../tools/builtin-guide.js';
import type { SmartRouteDecision } from './model-router.js';
import { ROUTING_CONFIG } from './routing-config.js';
import type {
    StreamCallback,
    Tool,
    ToolContext,
} from './types.js';

export type {
    StreamChunk,
    StreamCallback,
    FunctionDeclaration,
    ToolMeta,
    Tool,
    ToolContext,
} from './types.js';

setupLogger();

// ── Tool registry ─────────────────────────────────────────────────────────────

const toolRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    toolRegistry.set(tool.declaration.name, tool);
    log.info('AgentRuntime', `Tool registered: ${tool.declaration.name}`);
}

export function getToolRegistry(): Map<string, Tool> {
    return toolRegistry;
}

// ── Model helpers ─────────────────────────────────────────────────────────────

/** Resolve a short alias (e.g. "flash") to the canonical model ID. */
export function resolveModel(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

/** Check if a model ID belongs to the DeepSeek provider. */
function isDeepSeekModel(modelId: string): boolean {
    return modelId.startsWith('deepseek');
}

/** Check if a model ID belongs to a local Ollama instance. */
function isOllamaModel(modelId: string): boolean {
    return modelId.startsWith('ollama/');
}

/** Check if a model ID uses the Gemini CLI ACP provider. */
function isAcpModel(modelId: string): boolean {
    return modelId.startsWith('acp/');
}

/** Check if a model ID belongs to OpenAI (GPT family). */
function isOpenAIModel(modelId: string): boolean {
    return modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-');
}

/** Check if a model ID belongs to Anthropic (Claude family). */
function isAnthropicModel(modelId: string): boolean {
    return modelId.startsWith('claude-');
}

/** Create an AI SDK LanguageModel for a given model id. */
function createModel(modelId: string): LanguageModel {
    if (isDeepSeekModel(modelId)) {
        const deepseek = createOpenAI({
            apiKey: DEEPSEEK_API_KEY,
            baseURL: 'https://api.deepseek.com',
        });
        return deepseek.chat(modelId);
    }
    if (isOllamaModel(modelId)) {
        const ollama = createOpenAI({
            apiKey: 'ollama',
            baseURL: OLLAMA_BASE_URL,
        });
        return ollama.chat(modelId.replace('ollama/', ''));
    }
    if (isOpenAIModel(modelId)) {
        const openai = createOpenAI({ apiKey: OPENAI_API_KEY });
        return openai.chat(modelId);
    }
    if (isAnthropicModel(modelId)) {
        const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });
        return anthropic(modelId);
    }
    // ACP models are handled directly in chatWithContextStreaming / generate
    // and never reach createModel.
    const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
    return google(modelId);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error('Request timeout')), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    ctrl.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
    return ctrl.signal;
}

type ErrorKind = 'switch-model' | 'retry-same' | 'fatal';

function classifyError(err: unknown): ErrorKind {
    const e = err as { status?: number; code?: string; message?: string; cause?: { status?: number; code?: string } };
    const status = e.status ?? e.cause?.status;
    const code = String(e.code ?? e.cause?.code ?? '');
    const msg = String(e.message ?? '').toLowerCase();
    if (status === 400 || status === 401 || status === 403) return 'fatal';
    if (status === 500) return 'retry-same';
    if (status === 429 || status === 503) return 'switch-model';
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return 'switch-model';
    if (msg.includes('timeout')) return 'switch-model';
    return 'switch-model';
}

function pickAliases(
    modelOverride: string | undefined,
    route: SmartRouteDecision | undefined,
    forceFreeOnly: boolean,
): string[] {
    const chain = route?.fallbackChain?.length
        ? route.fallbackChain
        : modelOverride ? [modelOverride] : [GEMINI_MODEL_ENV ?? 'flash', 'deepseek', 'gemma', 'gemini-acp'];
    if (!forceFreeOnly) return [...new Set(chain)];
    const freeOnly = [...new Set(chain.filter((alias) => isFreeModel(resolveModel(alias))))];
    return freeOnly.length ? freeOnly : ['gemma'];
}

// ── System instruction helpers ────────────────────────────────────────────────

/**
 * Load system instruction from a config directory.
 * Reads AGENTS.md (required) + optional SOUL.md, TOOLS.md, XIFENG.md.
 * Falls back to legacy agent.md if AGENTS.md not found.
 */
export async function loadSystemInstruction(configDir: string, ...fallbackDirs: string[]): Promise<string> {
    const dirs = [configDir, ...fallbackDirs].filter(Boolean);

    for (const dir of dirs) {
        try {
            const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8');
            const parts: string[] = [agents.trim()];
            const loadedFiles = ['AGENTS.md'];
            for (const file of ['SOUL.md', 'TOOLS.md', 'XIFENG.md']) {
                try {
                    const content = await fs.readFile(join(dir, file), 'utf8');
                    if (content.trim()) {
                        parts.push(content.trim());
                        loadedFiles.push(file);
                    }
                } catch { /* optional */ }
            }
            const merged = parts.join('\n\n---\n\n');
            log.info('AgentRuntime', `Loaded prompt from: ${dir} (${loadedFiles.join(' + ')})`);
            return merged;
        } catch { /* try next dir */ }
    }

    for (const dir of dirs) {
        try {
            const content = await fs.readFile(join(dir, 'agent.md'), 'utf8');
            log.info('AgentRuntime', `Loaded agent.md from: ${dir}`);
            return content;
        } catch { /* try next */ }
    }
    return '';
}

/**
 * Build the full system instruction for a tenant, combining:
 * 1. Config files (AGENTS.md, SOUL.md, etc.)
 * 2. Auto-generated built-in tools reference (from tool registry)
 * 3. USER.md (user profile)
 */
export async function buildTenantSystemInstruction(workDir: string): Promise<string> {
    const configDir = join(workDir, 'config');
    const parts: string[] = [];

    // Try config/ first, fall back to workspace root (where AGENTS.md etc. often live)
    const si = await loadSystemInstruction(configDir, workDir);
    if (si) parts.push(si);

    // Auto-inject built-in tools reference so per-user TOOLS.md need not document them
    const toolsGuide = buildBuiltinToolsGuide(toolRegistry);
    parts.push(toolsGuide);

    // Inject USER.md into system prompt so the agent knows the user
    try {
        const userMd = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
        if (userMd.trim()) {
            parts.push(`[用户档案]\n${userMd.trim()}`);
        }
    } catch { /* USER.md not found — skip */ }

    return parts.join('\n\n---\n\n');
}

// ── LLMClient ─────────────────────────────────────────────────────────────────

/**
 * Keep the most useful parts of NOW.md when it overflows the prompt budget.
 *
 * Strategy: take the first N bytes while preferring to cut on section/line
 * boundaries. Always keep the opening sections (Mission / Priorities) — they
 * tend to be at the top by convention — and drop the tail.
 */
function excerptNowMd(text: string, budgetBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= budgetBytes) return text;
    const lines = text.split('\n');
    const out: string[] = [];
    let used = 0;
    for (const line of lines) {
        const next = used + Buffer.byteLength(line + '\n', 'utf8');
        if (next > budgetBytes) break;
        out.push(line);
        used = next;
    }
    return out.join('\n').trimEnd();
}

export class LLMClient {
    private enabled = false;
    private modelId = '';

    constructor() {
        if (!GEMINI_API_KEY && !DEEPSEEK_API_KEY && !OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
            log.warn('AgentRuntime', 'No cloud API key set (GEMINI/DEEPSEEK/OPENAI/ANTHROPIC). Ollama/ACP may still work.');
        }

        // Default: prefer Gemini → DeepSeek → OpenAI → Anthropic → Ollama
        const defaultModel = GEMINI_API_KEY ? 'flash'
            : DEEPSEEK_API_KEY ? 'deepseek'
            : OPENAI_API_KEY ? 'gpt-4o-mini'
            : ANTHROPIC_API_KEY ? 'claude-haiku'
            : 'gemma';
        this.modelId = resolveModel(GEMINI_MODEL_ENV ?? defaultModel);
        this.enabled = true;
        log.info('AgentRuntime', `Initialized (AI SDK). Model: ${this.modelId}`);
    }

    private async buildPrompt(message: string, workDir: string, history?: string, sessionId?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

        try {
            const nowMdPath = join(workDir, 'memory', 'NOW.md');
            const nowMd = await fs.readFile(nowMdPath, 'utf8');
            const trimmed = nowMd.trim();
            if (trimmed) {
                // NOW.md is injected every turn — apply a soft size budget.
                // 2KB is enough for a focused snapshot; anything larger likely
                // drifted into journal territory.
                const NOW_SOFT_BUDGET = 2048;
                let rendered = trimmed;
                if (Buffer.byteLength(trimmed, 'utf8') > NOW_SOFT_BUDGET) {
                    rendered = excerptNowMd(trimmed, NOW_SOFT_BUDGET) +
                        `\n\n…（NOW.md 被裁剪至 ${NOW_SOFT_BUDGET}B；完整版请用 save_memory 或 update_now 精简）`;
                }
                prompt += `\n[User Background & Long-term Goals]\n` +
                    `（以下是用户的长期目标与近况背景，仅供参考，不是本次对话的任务指令）\n` +
                    `${rendered}\n`;
            }
        } catch { /* NOW.md not found */ }

        // Recall relevant memories (episodic + semantic) for this query.
        // Best-effort: on any failure we simply skip the block.
        try {
            const hits = await recall(workDir, message, { topK: 5, budgetTokens: 400, sessionId });
            if (hits.length) {
                const rendered = renderHits(hits);
                prompt += `\n[Recalled Memories]\n（从过往对话/事实库召回，仅供参考；若与本次无关请忽略）\n${rendered}\n`;
            }
        } catch (err) {
            log.warn('AgentRuntime', 'recall failed', { err: err instanceof Error ? err.message : String(err) });
        }

        if (history?.trim()) {
            prompt += `\n[Previous Conversation History]\n${history}\n`;
        }
        prompt += `\n[New Message]\n${message}`;
        return prompt;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async chatWithContextStreaming(
        message: string,
        conversationHistory: string | Array<{ role: string; content: string }>,
        context: ToolContext,
        onChunk: StreamCallback,
        signal?: AbortSignal,
        modelOverride?: string,
        route?: SmartRouteDecision,
        images?: string[],
    ): Promise<string | null> {
        if (!this.enabled) {
            log.warn('AgentRuntime', `Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

        const workDir = context.workDir;
        const systemInstruction = context.systemInstruction || '';
        const dayCost = DAILY_COST_LIMIT > 0 ? await getDailyCost() : 0;
        const forceFreeOnly = DAILY_COST_LIMIT > 0 && dayCost >= DAILY_COST_LIMIT;
        let aliasChain = pickAliases(modelOverride, route, forceFreeOnly);
        if (!aliasChain.length) aliasChain = ['gemma'];

        // ── Standard AI SDK path ──────────────────────────────────────────
        const tools = buildAiTools(toolRegistry, workDir, context);

        // Build AI SDK messages array when structured history is available or images are attached
        const useMessages = (Array.isArray(conversationHistory) && conversationHistory.length > 0) || (images?.length ?? 0) > 0;

        let prompt: string | undefined;
        const messages: ModelMessage[] = [];

        if (useMessages) {
            // Use structured messages — build prompt without embedded history
            const runtimePrompt = await this.buildPrompt(message, workDir, undefined, context.sessionId);
            for (const msg of conversationHistory as Array<{ role: string; content: string }>) {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content,
                });
            }
            // Build multimodal content when images are attached
            if (images?.length) {
                const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> = [
                    { type: 'text', text: runtimePrompt },
                ];
                for (const dataUrl of images) {
                    parts.push({ type: 'image', image: new URL(dataUrl) });
                }
                messages.push({ role: 'user', content: parts });
            } else {
                messages.push({ role: 'user', content: runtimePrompt });
            }
        } else {
            // Fallback: embed history as a string in the prompt
            const historyStr = typeof conversationHistory === 'string' ? conversationHistory : '';
            prompt = await this.buildPrompt(message, workDir, historyStr || undefined, context.sessionId);
        }

        const startedAt = Date.now();
        const originalAlias = aliasChain[0];
        let lastError: unknown = null;

        for (let i = 0; i < aliasChain.length; i++) {
            const alias = aliasChain[i];
            const effectiveModel = resolveModel(alias);

            // ── ACP shortcut: bypass AI SDK, use Gemini CLI directly ──────
            if (isAcpModel(effectiveModel)) {
                const runtimePrompt = await this.buildPrompt(message, workDir, undefined, context.sessionId);
                const fullPrompt = systemInstruction
                    ? `${systemInstruction}\n\n${runtimePrompt}`
                    : runtimePrompt;
                try {
                    const text = await acpStream(
                        fullPrompt,
                        (chunk) => onChunk({ type: 'text', text: chunk }),
                        (chunk) => onChunk({ type: 'thought', text: chunk }),
                    );
                    return text || null;
                } catch (err: unknown) {
                    if (err instanceof Error && err.name === 'AbortError' && signal?.aborted) throw err;
                    lastError = err;
                    if (classifyError(err) === 'fatal' || i >= aliasChain.length - 1) {
                        log.error('AgentRuntime', 'ACP stream error', { error: err instanceof Error ? err.message : String(err) });
                        throw err;
                    }
                    continue;
                }
            }

            let sameModelRetryLeft = ROUTING_CONFIG.fallback.maxRetries;
            while (true) {
                try {
                    const baseOpts = {
                        model: createModel(effectiveModel),
                        system: systemInstruction,
                        tools,
                        stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
                        abortSignal: withTimeoutSignal(signal, STREAM_FIRST_CHUNK_TIMEOUT_MS),
                        temperature: 0.7,
                    };

                    const result = useMessages
                        ? streamText({ ...baseOpts, messages })
                        : streamText({ ...baseOpts, prompt: prompt! });

                    let fullText = '';

                    for await (const part of result.fullStream) {
                        switch (part.type) {
                            case 'reasoning-delta':
                                onChunk({ type: 'thought', text: part.text });
                                break;
                            case 'tool-call':
                                onChunk({ type: 'tool_call', toolName: part.toolName, args: part.input as Record<string, unknown> });
                                break;
                            case 'tool-result': {
                                const r = part.output;
                                const s = typeof r === 'string' ? r : JSON.stringify(r);
                                const resultId = generateId();
                                setToolResult(resultId, {
                                    userId: context.userId,
                                    toolName: part.toolName,
                                    result: s,
                                });
                                const preview = smartTruncate(s);
                                onChunk({
                                    type: 'tool_result',
                                    toolName: part.toolName,
                                    result: preview,
                                    resultId,
                                    truncated: preview.length < s.length,
                                });
                                break;
                            }
                            case 'text-delta':
                                onChunk({ type: 'text', text: part.text });
                                fullText += part.text;
                                break;
                            case 'error':
                                log.error('AgentRuntime', 'Stream error', { error: part.error instanceof Error ? part.error.message : String(part.error) });
                                onChunk({ type: 'text', text: `\n\n🔥 Stream error: ${part.error instanceof Error ? part.error.message : String(part.error)}` });
                                break;
                        }
                    }

                    // Record token usage (PromiseLike — wrap in Promise.resolve for .catch)
                    Promise.resolve(result.usage).then((usage) => {
                        if (usage) {
                            const promptTokens = usage.inputTokens ?? 0;
                            const completionTokens = usage.outputTokens ?? 0;
                            const totalTokens = usage.totalTokens ?? (promptTokens + completionTokens);
                            recordTokenUsage({
                                ts: new Date().toISOString(),
                                model: effectiveModel,
                                promptTokens,
                                completionTokens,
                                totalTokens,
                                caller: 'chatWithContextStreaming',
                            });
                            const baseReason = route?.reason ?? 'scored';
                            const reason = forceFreeOnly ? `${baseReason}|budget_limited` : baseReason;
                            // Capture the actual user prompt sent to the model.
                            // In messages mode, extract user-role messages and join them
                            // with '---' separators to mirror the multi-turn structure.
                            let actualUserPrompt: string;
                            if (useMessages) {
                                const userParts = messages
                                    .filter(m => m.role === 'user')
                                    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
                                actualUserPrompt = userParts.join('\n---\n');
                            } else {
                                actualUserPrompt = prompt ?? '';
                            }
                            void appendUsageRecord({
                                timestamp: Date.now(),
                                userId: context.userId,
                                model: effectiveModel,
                                tier: route?.tier ?? 'standard',
                                score: route?.score ?? 0,
                                confidence: route?.confidence ?? 1,
                                reason,
                                promptTokens,
                                completionTokens,
                                totalTokens,
                                estimatedCost: estimateCost(effectiveModel, promptTokens, completionTokens),
                                durationMs: Date.now() - startedAt,
                                fallbackUsed: alias !== originalAlias,
                                originalModel: alias !== originalAlias ? resolveModel(originalAlias) : undefined,
                                sessionId: context.sessionId,
                                systemPrompt: systemInstruction || undefined,
                                userPrompt: actualUserPrompt || undefined,
                            }).catch(() => { /* never crash over tracking */ });
                        }
                    }).catch(() => { /* never crash over tracking */ });

                    return fullText || null;
                } catch (err: unknown) {
                    // Re-throw only if the *user-provided* signal was cancelled.
                    // Timeout aborts also surface as AbortError but should fall
                    // through to the fallback chain instead of aborting the turn.
                    if (err instanceof Error && err.name === 'AbortError' && signal?.aborted) throw err;
                    lastError = err;
                    const kind = classifyError(err);
                    if (kind === 'retry-same' && sameModelRetryLeft > 0) {
                        sameModelRetryLeft--;
                        await sleep(1000);
                        continue;
                    }
                    if (kind === 'fatal' || i >= aliasChain.length - 1) {
                        log.error('AgentRuntime', 'LLM call error', { error: err instanceof Error ? err.message : String(err), model: effectiveModel });
                        throw err;
                    }
                    break;
                }
            }
        }

        throw lastError instanceof Error ? lastError : new Error('All fallback models failed');
    }

    /** Non-streaming generation with tool support, used by subagent. */
    async generateWithTools(
        prompt: string,
        toolSet: import('ai').ToolSet,
        options?: { model?: string; system?: string; temperature?: number; maxSteps?: number },
    ): Promise<string | null> {
        if (!this.enabled) return null;
        const modelId = options?.model ? resolveModel(options.model) : this.modelId;
        const steps = options?.maxSteps ?? MAX_SUBAGENT_STEPS;
        try {
            const { text, usage } = await generateText({
                model: createModel(modelId),
                prompt,
                system: options?.system,
                temperature: options?.temperature ?? 0.7,
                tools: toolSet,
                stopWhen: stepCountIs(steps),
            });
            if (usage) {
                recordTokenUsage({
                    ts: new Date().toISOString(),
                    model: modelId,
                    promptTokens: usage.inputTokens ?? 0,
                    completionTokens: usage.outputTokens ?? 0,
                    totalTokens: usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
                    caller: 'generateWithTools',
                });
            }
            return text || null;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return `🔥 Subagent error: ${msg}`;
        }
    }

    /** Simple text generation without streaming or tools. */
    async generate(
        prompt: string,
        options?: { model?: string; system?: string; temperature?: number },
    ): Promise<string | null> {
        if (!this.enabled) return null;
        const forceFreeOnly = DAILY_COST_LIMIT > 0 && (await getDailyCost()) >= DAILY_COST_LIMIT;
        const aliases = pickAliases(options?.model, undefined, forceFreeOnly);
        const fallbackAliases = aliases.length ? aliases : ['gemma'];
        for (let i = 0; i < fallbackAliases.length; i++) {
            const modelId = resolveModel(fallbackAliases[i]);
            if (isAcpModel(modelId)) {
                const fullPrompt = options?.system ? `${options.system}\n\n${prompt}` : prompt;
                try { return await acpGenerate(fullPrompt); } catch { continue; }
            }
            try {
                const { text, usage } = await generateText({
                    model: createModel(modelId),
                    prompt,
                    system: options?.system,
                    temperature: options?.temperature,
                    abortSignal: withTimeoutSignal(undefined, GENERATE_TIMEOUT_MS),
                });
                if (usage) {
                    recordTokenUsage({
                        ts: new Date().toISOString(),
                        model: modelId,
                        promptTokens: usage.inputTokens ?? 0,
                        completionTokens: usage.outputTokens ?? 0,
                        totalTokens: usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
                        caller: 'generate',
                    });
                }
                return text || null;
            } catch (err) {
                log.error('LLMClient', 'generate error', { error: err instanceof Error ? err.message : String(err), model: modelId });
                if (classifyError(err) === 'fatal' || i >= fallbackAliases.length - 1) return null;
            }
        }
        return null;
    }

    /** No-op: no subprocess to terminate. */
    close(): void {}
}

/** Shared singleton — avoids repeated initialization logs. */
export const llmClient = new LLMClient();
