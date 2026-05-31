/**
 * src/llm/client.ts — LLM client powered by Vercel AI SDK.
 *
 * Wraps AI SDK's streamText / generateText and exposes the same high-level
 * chat methods used throughout the application.  The tool registry, system
 * instruction loading, and prompt construction live here.
 *
 * Simplified: always uses DeepSeek (via Anthropic API compat). No multi-model
 * fallback, no Gemini ACP shortcut, no cost-budget enforcement.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { streamText, generateText, stepCountIs, type ModelMessage } from 'ai';
import { setupLogger, log } from '../utils/logger.js';
import { recordTokenUsage } from '../utils/token-tracker.js';
import { GENERATE_TIMEOUT_MS, MAX_SUBAGENT_STEPS, MAX_TOOL_ITERATIONS, STREAM_FIRST_CHUNK_TIMEOUT_MS } from '../config.js';
import { buildAiTools } from './ai-tools.js';
import { extractUsageNumbers, recordUsage } from './invoke.js';
import { setToolResult, smartTruncate } from '../utils/tool-result-cache.js';
import { generateId } from '../utils/id-generator.js';
import type { SmartRouteDecision } from './model-router.js';
import { createLanguageModel, resolveModel } from './model-factory.js';
import type {
    StreamCallback,
    Tool,
    ToolContext,
} from './types.js';
import { recall, renderHits } from '../memory/index.js';

export { resolveModel } from './model-factory.js';

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
 * 2. User profile (USER.md)
 */
export async function buildTenantSystemInstruction(workDir: string): Promise<string> {
    const configDir = join(workDir, 'config');
    const parts: string[] = [];

    const si = await loadSystemInstruction(configDir, workDir);
    if (si) parts.push(si);

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
        this.modelId = resolveModel('deepseek');
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
        const effectiveModel = modelOverride
            ? resolveModel(modelOverride)
            : (route?.model ? resolveModel(route.model) : this.modelId);

        const tools = buildAiTools(toolRegistry, workDir, context);
        const useMessages = (Array.isArray(conversationHistory) && conversationHistory.length > 0) || (images?.length ?? 0) > 0;

        let prompt: string | undefined;
        const messages: ModelMessage[] = [];

        if (useMessages) {
            const runtimePrompt = await this.buildPrompt(message, workDir, stateDir, undefined, context.sessionId);
            for (const msg of conversationHistory as Array<{ role: string; content: string }>) {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content,
                });
            }
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
            const historyStr = typeof conversationHistory === 'string' ? conversationHistory : '';
            prompt = await this.buildPrompt(message, workDir, stateDir, historyStr || undefined, context.sessionId);
        }

        const startedAt = Date.now();

        try {
            const { signal: streamSignal, ping: pingStream } = withIdleTimeoutSignal(signal, STREAM_FIRST_CHUNK_TIMEOUT_MS);
            const baseOpts = {
                model: createLanguageModel(effectiveModel),
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
                pingStream();
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
                        onChunk({ type: 'text', text: `\n\nStream error: ${part.error instanceof Error ? part.error.message : String(part.error)}` });
                        break;
                }
            }

            // ── Synthesis fallback when stream stopped due to MAX_TOOL_ITERATIONS ──
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
                        model: createLanguageModel(effectiveModel),
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

            // Record token usage
            Promise.resolve(result.usage).then((usage) => {
                if (usage) {
                    const actualUserPrompt = useMessages
                        ? messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n---\n')
                        : (prompt ?? '');
                    void recordUsage({
                        userId: context.userId,
                        stateDir: context.stateDir ?? context.workDir,
                        model: effectiveModel,
                        ...extractUsageNumbers(usage),
                        startedAt,
                        caller: 'chatWithContextStreaming',
                        systemPrompt: systemInstruction || undefined,
                        userPrompt: actualUserPrompt || undefined,
                        sessionId: context.sessionId,
                        reason: route?.reason ?? 'fixed',
                    });
                }
            }).catch(() => { /* never crash over tracking */ });

            return fullText || null;
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            log.error('AgentRuntime', 'LLM call error', { error: err instanceof Error ? err.message : String(err), model: effectiveModel });
            throw err;
        }
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
                model: createLanguageModel(modelId),
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
            return `Subagent error: ${msg}`;
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
        const modelId = options?.model ? resolveModel(options.model) : this.modelId;

        try {
            const { text, usage } = await generateText({
                model: createLanguageModel(modelId),
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
            return null;
        }
    }

    /** No-op: no subprocess to terminate. */
    close(): void {}
}
