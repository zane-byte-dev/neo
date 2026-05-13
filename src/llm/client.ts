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
import { DAILY_COST_LIMIT, GEMINI_MODEL_ENV, GENERATE_TIMEOUT_MS, MAX_SUBAGENT_STEPS, MAX_TOOL_ITERATIONS, MODEL_ALIASES, OLLAMA_BASE_URL, STREAM_FIRST_CHUNK_TIMEOUT_MS, getAnthropicApiKey, getDeepseekApiKey, getGeminiApiKey, getOpenAIApiKey } from '../config.js';
import { buildAiTools } from './ai-tools.js';
import { acpStream, acpGenerate } from './providers/gemini-acp.js';
import { appendUsageRecord, estimateCost, getDailyCost, isFreeModel } from './cost.js';
import { setToolResult, smartTruncate } from '../utils/tool-result-cache.js';
import { generateId } from '../utils/id-generator.js';
import type { SmartRouteDecision } from './model-router.js';
import { ROUTING_CONFIG } from './routing-config.js';
import type {
    StreamCallback,
    Tool,
    ToolContext,
} from './types.js';
import { recall, renderHits } from '../memory/index.js';

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
            apiKey: getDeepseekApiKey(),
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
        const openai = createOpenAI({ apiKey: getOpenAIApiKey() });
        return openai.chat(modelId);
    }
    if (isAnthropicModel(modelId)) {
        const anthropic = createAnthropic({ apiKey: getAnthropicApiKey() });
        return anthropic(modelId);
    }
    // ACP models are handled directly in chatWithContextStreaming / generate
    // and never reach createModel.
    const google = createGoogleGenerativeAI({ apiKey: getGeminiApiKey() });
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

/**
 * 空闲超时：每次调用 ping() 都会重置计时器。
 * 用于流式请求——只要持续有 chunk 输出就不会超时，只有真正无响应时才触发。
 */
function withIdleTimeoutSignal(
    signal: AbortSignal | undefined,
    timeoutMs: number,
): { signal: AbortSignal; ping: () => void } {
    const ctrl = new AbortController();
    let t: ReturnType<typeof setTimeout> = setTimeout(
        () => ctrl.abort(new Error('Request timeout')),
        timeoutMs,
    );
    const ping = () => {
        clearTimeout(t);
        if (!ctrl.signal.aborted) {
            t = setTimeout(() => ctrl.abort(new Error('Request timeout')), timeoutMs);
        }
    };
    if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    ctrl.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
    return { signal: ctrl.signal, ping };
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
 * 2. Workspace skills ({workDir}/config/skills/)
 * 3. Global OpenClaw skills (~/.openclaw/workspace/skills/)
 */
export async function buildTenantSystemInstruction(workDir: string): Promise<string> {
    const configDir = join(workDir, 'config');
    const parts: string[] = [];

    // Try config/ first, fall back to workspace root (where AGENTS.md etc. often live)
    const si = await loadSystemInstruction(configDir, workDir);
    if (si) parts.push(si);

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

export class LLMClient {
    private enabled = false;
    private modelId = '';

    constructor() {
        const geminiKey = getGeminiApiKey();
        const deepseekKey = getDeepseekApiKey();
        const openaiKey = getOpenAIApiKey();
        const anthropicKey = getAnthropicApiKey();
        if (!geminiKey && !deepseekKey && !openaiKey && !anthropicKey) {
            log.warn('AgentRuntime', 'No cloud API key set (GEMINI/DEEPSEEK/OPENAI/ANTHROPIC). Ollama/ACP may still work.');
        }

        // Default: prefer Gemini → DeepSeek → OpenAI → Anthropic → Ollama
        const defaultModel = geminiKey ? 'flash'
            : deepseekKey ? 'deepseek'
            : openaiKey ? 'gpt-4o-mini'
            : anthropicKey ? 'claude-haiku'
            : 'gemma';
        this.modelId = resolveModel(GEMINI_MODEL_ENV ?? defaultModel);
        this.enabled = true;
        log.info('AgentRuntime', `Initialized (AI SDK). Model: ${this.modelId}`);
    }

    private async buildPrompt(message: string, workDir: string, stateDir: string, history?: string, sessionId?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

        try {
            const nowMdPath = join(stateDir, 'memory', 'NOW.md');
            const nowMd = await fs.readFile(nowMdPath, 'utf8');
            if (nowMd.trim()) {
                prompt += `\n[User Background & Long-term Goals]\n` +
                    `（以下是用户的长期目标与近况背景，仅供参考，不是本次对话的任务指令）\n` +
                    `${nowMd.trim()}\n`;
            }
        } catch { /* NOW.md not found */ }

        // Inject relevant memory recall hits (episodic + semantic)
        try {
            const hits = await recall(workDir, message, {
                topK: 5,
                budgetTokens: 1200,
                stateDir,
                sessionId,
            });
            const rendered = renderHits(hits);
            if (rendered) {
                prompt += `\n[Relevant Memory]\n${rendered}\n`;
            }
        } catch { /* memory recall is best-effort */ }

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
        const stateDir = context.stateDir;
        const systemInstruction = context.systemInstruction || '';
        const dayCost = DAILY_COST_LIMIT > 0 ? await getDailyCost(stateDir) : 0;
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
            const runtimePrompt = await this.buildPrompt(message, workDir, stateDir, undefined, context.sessionId);
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
            prompt = await this.buildPrompt(message, workDir, stateDir, historyStr || undefined, context.sessionId);
        }

        const startedAt = Date.now();
        const originalAlias = aliasChain[0];
        let lastError: unknown = null;

        for (let i = 0; i < aliasChain.length; i++) {
            const alias = aliasChain[i];
            const effectiveModel = resolveModel(alias);

            // ── ACP shortcut: bypass AI SDK, use Gemini CLI directly ──────
            if (isAcpModel(effectiveModel)) {
                const runtimePrompt = await this.buildPrompt(message, workDir, stateDir, undefined, context.sessionId);
                const fullPrompt = systemInstruction
                    ? `${systemInstruction}\n\n${runtimePrompt}`
                    : runtimePrompt;
                try {
                    const text = await acpStream(
                        fullPrompt,
                        (chunk) => onChunk({ type: 'text', text: chunk }),
                        (chunk) => onChunk({ type: 'thought', text: chunk }),
                        workDir,
                    );
                    return text || null;
                } catch (err: unknown) {
                    if (err instanceof Error && err.name === 'AbortError') throw err;
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
                    // 使用空闲超时：只要持续有 chunk 输出就不会超时
                    const { signal: streamSignal, ping: pingStream } = withIdleTimeoutSignal(signal, STREAM_FIRST_CHUNK_TIMEOUT_MS);
                    const baseOpts = {
                        model: createModel(effectiveModel),
                        system: systemInstruction,
                        tools,
                        stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
                        abortSignal: streamSignal,
                        temperature: 0.7,
                    };

                    const result = useMessages
                        ? streamText({ ...baseOpts, messages })
                        : streamText({ ...baseOpts, prompt: prompt! });

                    let fullText = '';

                    for await (const part of result.fullStream) {
                        pingStream(); // 每个 chunk 重置空闲计时器
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

                    // ── Synthesis fallback when stream stopped due to MAX_TOOL_ITERATIONS ──
                    // 当 stopWhen 触发时，模型可能还想继续调用工具但被强制中断，导致最终
                    // 文本几乎为空。这里基于已收集到的 tool 结果再跑一次无工具的回答，
                    // 保证用户拿到一段“尽力而为”的总结而不是半句话。
                    try {
                        const finishReason = await result.finishReason;
                        const stepsArr = await result.steps;
                        const stoppedAtMaxSteps =
                            finishReason === 'tool-calls' || stepsArr.length >= MAX_TOOL_ITERATIONS;
                        const textTooShort = fullText.trim().length < 120;
                        if (stoppedAtMaxSteps && textTooShort) {
                            log.info('AgentRuntime', 'Triggering synthesis after max-iter stop', {
                                finishReason,
                                steps: stepsArr.length,
                                fullTextLen: fullText.length,
                            });
                            const responseMsgs = (await result.response).messages;
                            const synthesisInput: ModelMessage[] = [
                                ...(useMessages ? messages : [{ role: 'user' as const, content: prompt ?? '' }]),
                                ...responseMsgs,
                                {
                                    role: 'user',
                                    content:
                                        '工具调用次数已达上限，无法继续调用工具。请基于以上工具结果与上下文，' +
                                        '直接回答我最初的问题。如果信息不足，请简明指出还缺什么，并给出基于已知信息的最佳推断。' +
                                        '不要再请求调用任何工具。',
                                },
                            ];
                            onChunk({ type: 'text', text: '\n\n' });
                            const synthesis = streamText({
                                model: createModel(effectiveModel),
                                system: systemInstruction,
                                messages: synthesisInput,
                                abortSignal: signal,
                                temperature: 0.5,
                            });
                            for await (const sp of synthesis.fullStream) {
                                if (sp.type === 'text-delta') {
                                    onChunk({ type: 'text', text: sp.text });
                                    fullText += sp.text;
                                } else if (sp.type === 'reasoning-delta') {
                                    onChunk({ type: 'thought', text: sp.text });
                                } else if (sp.type === 'error') {
                                    log.warn('AgentRuntime', 'Synthesis stream error', {
                                        error: sp.error instanceof Error ? sp.error.message : String(sp.error),
                                    });
                                }
                            }
                        }
                    } catch (synthErr) {
                        log.warn('AgentRuntime', 'Synthesis pass failed', {
                            error: synthErr instanceof Error ? synthErr.message : String(synthErr),
                        });
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
                            }, context.stateDir ?? context.workDir).catch(() => { /* never crash over tracking */ });
                        }
                    }).catch(() => { /* never crash over tracking */ });

                    return fullText || null;
                } catch (err: unknown) {
                    if (err instanceof Error && err.name === 'AbortError') throw err;
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
        options?: { model?: string; system?: string; temperature?: number; workDir?: string },
    ): Promise<string | null> {
        return (await this.generateWithUsage(prompt, options))?.text ?? null;
    }

    async generateWithUsage(
        prompt: string,
        options?: { model?: string; system?: string; temperature?: number; userId?: string; context?: string },
    ): Promise<{ text: string; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } } | null> {
        if (!this.enabled) return null;
        const forceFreeOnly = DAILY_COST_LIMIT > 0 && (await getDailyCost('')) >= DAILY_COST_LIMIT;
        const aliases = pickAliases(options?.model, undefined, forceFreeOnly);
        const fallbackAliases = aliases.length ? aliases : ['gemma'];
        for (let i = 0; i < fallbackAliases.length; i++) {
            const modelId = resolveModel(fallbackAliases[i]);
            if (isAcpModel(modelId)) {
                const fullPrompt = options?.system ? `${options.system}\n\n${prompt}` : prompt;
                try {
                    const text = await acpGenerate(fullPrompt);
                    return text ? { text, model: modelId, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } : null;
                } catch { continue; }
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
                        caller: options?.context ?? 'generate',
                    });
                }
                const inputTokens = usage?.inputTokens ?? 0;
                const outputTokens = usage?.outputTokens ?? 0;
                return {
                    text: text || '',
                    model: modelId,
                    usage: { inputTokens, outputTokens, totalTokens: usage?.totalTokens ?? (inputTokens + outputTokens) },
                };
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
