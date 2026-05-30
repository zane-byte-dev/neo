import { generateText, streamText, type FinishReason, type LanguageModelUsage, type ModelMessage, type ToolSet } from 'ai';
import { MODEL_ALIASES, GENERATE_TIMEOUT_MS, STREAM_FIRST_CHUNK_TIMEOUT_MS } from '../config.js';
import { appendUsageRecord, estimateCost } from '../llm/cost.js';
import { acpGenerate } from '../llm/providers/gemini-acp.js';
import { getFallbackChain, ROUTING_CONFIG, type Tier } from '../llm/routing-config.js';
import { isModelAliasAvailable, resolveSmartRoute, type SmartRouteDecision } from '../llm/model-router.js';
import { createLanguageModel, isAcpModel, resolveModel } from '../llm/model-factory.js';
import { GatewayError, toGatewayError } from '../llm/gateway/errors.js';
import {
    encodeOpenAIChatCompletion,
    encodeOpenAIChunk,
    encodeOpenAIDone,
    normalizeOpenAIRequest,
    type OpenAIChatRequest,
} from '../llm/gateway/openai.js';
import {
    encodeAnthropicEvent,
    encodeAnthropicMessage,
    mapAnthropicStopReason,
    normalizeAnthropicRequest,
    type AnthropicContentBlock,
    type AnthropicMessagesRequest,
} from '../llm/gateway/anthropic.js';
import { recordTokenUsage } from '../utils/token-tracker.js';
import { generateId } from '../utils/id-generator.js';
import { userGetStateDir, userGetWorkspaceDir } from './user-service.js';

interface GatewayCallContext {
    userId: string;
    allowFallback?: boolean;
    abortSignal?: AbortSignal;
}

interface SelectedModels {
    requestedModel: string;
    candidates: string[];
    route?: SmartRouteDecision;
    tier: Tier;
    score: number;
    confidence: number;
    reason: string;
}

interface UserDirs {
    workDir: string;
    stateDir: string;
}

interface UsageMeta {
    userId: string;
    stateDir: string;
    model: string;
    selection: SelectedModels;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    startedAt: number;
    fallbackUsed: boolean;
    caller: string;
    system?: string;
    promptText: string;
}

function getUserDirs(userId: string): UserDirs {
    const workDir = userGetWorkspaceDir(userId);
    const stateDir = userGetStateDir(userId);
    if (!workDir || !stateDir) {
        throw new GatewayError(500, 'gateway_user_not_configured', 'Gateway user workspace is not configured', 'server_error');
    }
    return { workDir, stateDir };
}

function isKnownAlias(model: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, model);
}

function isSupportedModelName(model: string): boolean {
    if (model === 'auto' || isKnownAlias(model)) return true;
    if (Object.values(MODEL_ALIASES).includes(model)) return true;
    return model.startsWith('gemini')
        || model.startsWith('acp/')
        || model.startsWith('deepseek')
        || model.startsWith('ollama/')
        || model.startsWith('gpt-')
        || model.startsWith('o1-')
        || model.startsWith('o3-')
        || model.startsWith('o4-')
        || model.startsWith('claude-')
        || model.startsWith('claude-code/');
}

function findTier(alias: string): Tier | undefined {
    for (const tier of ['simple', 'standard', 'complex'] as Tier[]) {
        if (ROUTING_CONFIG.tiers[tier].includes(alias)) return tier;
    }
    return undefined;
}

function selectModels(requestedModel: string, promptText: string, allowFallback: boolean, hasTools: boolean): SelectedModels {
    if (!isSupportedModelName(requestedModel)) {
        throw new GatewayError(404, 'unknown_model', `Unknown model: ${requestedModel}`);
    }

    if (requestedModel === 'auto') {
        const route = resolveSmartRoute({
            hasTools,
            message: promptText,
            conversationDepth: 0,
            toolCount: hasTools ? 1 : 0,
        });
        const candidates = route.fallbackChain.length ? route.fallbackChain : [route.model];
        return {
            requestedModel,
            candidates: candidates.filter((candidate) => !isKnownAlias(candidate) || isModelAliasAvailable(candidate)),
            route,
            tier: route.tier,
            score: route.score,
            confidence: route.confidence,
            reason: route.reason,
        };
    }

    if (isKnownAlias(requestedModel) && !isModelAliasAvailable(requestedModel)) {
        throw new GatewayError(400, 'provider_not_configured', `Provider for model ${requestedModel} is not configured`);
    }

    const tier = findTier(requestedModel) ?? 'standard';
    const candidates = allowFallback && isKnownAlias(requestedModel)
        ? getFallbackChain(requestedModel, tier)
        : [requestedModel];

    return {
        requestedModel,
        candidates,
        tier,
        score: 0,
        confidence: 1,
        reason: allowFallback && candidates.length > 1 ? 'user_selected_allow_fallback' : 'user_selected',
    };
}

function classifyError(err: unknown): 'fatal' | 'switch-model' {
    if (err instanceof GatewayError) return err.status >= 500 || err.status === 429 ? 'switch-model' : 'fatal';
    const e = err as { status?: number; code?: string; message?: string; cause?: { status?: number; code?: string } };
    const status = e.status ?? e.cause?.status;
    const code = String(e.code ?? e.cause?.code ?? '');
    const msg = String(e.message ?? '').toLowerCase();
    if (status === 400 || status === 401 || status === 403 || status === 404) return 'fatal';
    if (status === 429 || status === 500 || status === 503) return 'switch-model';
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return 'switch-model';
    if (msg.includes('timeout')) return 'switch-model';
    return 'switch-model';
}

function usageNumbers(usage: LanguageModelUsage | undefined): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const promptTokens = usage?.inputTokens ?? 0;
    const completionTokens = usage?.outputTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
}

async function recordGatewayUsage(meta: UsageMeta): Promise<void> {
    recordTokenUsage({
        ts: new Date().toISOString(),
        model: meta.model,
        promptTokens: meta.promptTokens,
        completionTokens: meta.completionTokens,
        totalTokens: meta.totalTokens,
        caller: meta.caller,
    });
    await appendUsageRecord({
        timestamp: Date.now(),
        userId: meta.userId,
        model: meta.model,
        tier: meta.selection.tier,
        score: meta.selection.score,
        confidence: meta.selection.confidence,
        reason: meta.selection.reason,
        promptTokens: meta.promptTokens,
        completionTokens: meta.completionTokens,
        totalTokens: meta.totalTokens,
        estimatedCost: estimateCost(meta.model, meta.promptTokens, meta.completionTokens),
        durationMs: Date.now() - meta.startedAt,
        fallbackUsed: meta.fallbackUsed,
        originalModel: meta.fallbackUsed ? resolveModel(meta.selection.candidates[0]) : undefined,
        caller: meta.caller,
        systemPrompt: meta.system,
        userPrompt: meta.promptText,
    }, meta.stateDir).catch(() => { /* never crash over tracking */ });
}

function acpPrompt(system: string | undefined, messages: ModelMessage[]): string {
    const parts: string[] = [];
    if (system) parts.push(system);
    for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        parts.push(`${msg.role}: ${content}`);
    }
    return parts.join('\n\n');
}

async function generateWithSelectedModel(args: {
    selection: SelectedModels;
    messages: ModelMessage[];
    system?: string;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    tools?: ToolSet;
    abortSignal?: AbortSignal;
}) {
    let lastError: unknown;
    for (let index = 0; index < args.selection.candidates.length; index++) {
        const candidate = args.selection.candidates[index];
        const modelId = resolveModel(candidate);
        try {
            if (isAcpModel(modelId)) {
                if (args.tools && Object.keys(args.tools).length > 0) {
                    throw new GatewayError(400, 'unsupported_model_tools', 'Selected model does not support gateway tool declarations');
                }
                const text = await acpGenerate(acpPrompt(args.system, args.messages));
                return {
                    modelId,
                    fallbackUsed: index > 0,
                    text: text ?? '',
                    content: [{ type: 'text' as const, text: text ?? '' }],
                    finishReason: 'stop' as FinishReason,
                    usage: undefined,
                };
            }
            const result = await generateText({
                model: createLanguageModel(modelId),
                messages: args.messages,
                system: args.system,
                temperature: args.temperature,
                maxOutputTokens: args.maxOutputTokens,
                topP: args.topP,
                tools: args.tools,
                abortSignal: args.abortSignal,
                timeout: { totalMs: GENERATE_TIMEOUT_MS },
            });
            return {
                modelId,
                fallbackUsed: index > 0,
                text: result.text,
                content: result.content,
                finishReason: result.finishReason,
                usage: result.totalUsage ?? result.usage,
            };
        } catch (err) {
            lastError = err;
            if (classifyError(err) === 'fatal' || index >= args.selection.candidates.length - 1) break;
        }
    }
    throw toGatewayError(lastError);
}

function anthropicContentFromParts(content: Array<unknown>, fallbackText: string): AnthropicContentBlock[] {
    const blocks: AnthropicContentBlock[] = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as { type?: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown };
        if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
        if (p.type === 'tool-call' && p.toolCallId && p.toolName) {
            blocks.push({ type: 'tool_use', id: p.toolCallId, name: p.toolName, input: p.input ?? {} });
        }
    }
    if (blocks.length === 0 && fallbackText) blocks.push({ type: 'text', text: fallbackText });
    return blocks;
}

export async function getGatewayModels(): Promise<object> {
    const data = Object.entries(MODEL_ALIASES)
        .filter(([alias]) => isModelAliasAvailable(alias))
        .map(([alias, modelId]) => ({
            id: alias,
            object: 'model',
            created: 0,
            owned_by: 'neo',
            x_neo: { modelId },
        }));
    if (data.length > 0) {
        data.unshift({ id: 'auto', object: 'model', created: 0, owned_by: 'neo', x_neo: { modelId: 'auto' } });
    }
    return { object: 'list', data };
}

export async function createOpenAIChatCompletion(body: OpenAIChatRequest, ctx: GatewayCallContext): Promise<object> {
    const normalized = normalizeOpenAIRequest(body);
    const dirs = getUserDirs(ctx.userId);
    const selection = selectModels(normalized.model, normalized.promptText, ctx.allowFallback === true, false);
    if (selection.candidates.length === 0) {
        throw new GatewayError(400, 'provider_not_configured', 'No configured model is available for this request');
    }
    const startedAt = Date.now();
    const result = await generateWithSelectedModel({ ...normalized, selection, abortSignal: ctx.abortSignal });
    const usage = usageNumbers(result.usage);
    await recordGatewayUsage({
        userId: ctx.userId,
        stateDir: dirs.stateDir,
        model: result.modelId,
        selection,
        ...usage,
        startedAt,
        fallbackUsed: result.fallbackUsed,
        caller: 'ai-gateway:openai',
        system: normalized.system,
        promptText: normalized.promptText,
    });
    return encodeOpenAIChatCompletion({
        id: `chatcmpl-${generateId()}`,
        model: result.modelId,
        content: result.text,
        finishReason: result.finishReason,
        usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
        },
    });
}

export async function* streamOpenAIChatCompletion(body: OpenAIChatRequest, ctx: GatewayCallContext): AsyncGenerator<string> {
    const normalized = normalizeOpenAIRequest({ ...body, stream: true });
    const dirs = getUserDirs(ctx.userId);
    const selection = selectModels(normalized.model, normalized.promptText, ctx.allowFallback === true, false);
    const id = `chatcmpl-${generateId()}`;
    const startedAt = Date.now();
    let lastError: unknown;

    for (let index = 0; index < selection.candidates.length; index++) {
        const modelId = resolveModel(selection.candidates[index]);
        let emitted = false;
        try {
            if (isAcpModel(modelId)) {
                const text = await acpGenerate(acpPrompt(normalized.system, normalized.messages));
                if (text) yield encodeOpenAIChunk({ id, model: modelId, content: text });
                yield encodeOpenAIChunk({ id, model: modelId, finishReason: 'stop' });
                yield encodeOpenAIDone();
                await recordGatewayUsage({
                    userId: ctx.userId,
                    stateDir: dirs.stateDir,
                    model: modelId,
                    selection,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    startedAt,
                    fallbackUsed: index > 0,
                    caller: 'ai-gateway:openai',
                    system: normalized.system,
                    promptText: normalized.promptText,
                });
                return;
            }
            const result = streamText({
                model: createLanguageModel(modelId),
                messages: normalized.messages,
                system: normalized.system,
                temperature: normalized.temperature,
                maxOutputTokens: normalized.maxOutputTokens,
                topP: normalized.topP,
                abortSignal: ctx.abortSignal,
                timeout: { chunkMs: STREAM_FIRST_CHUNK_TIMEOUT_MS },
            });
            for await (const part of result.fullStream) {
                if (part.type === 'text-delta') {
                    emitted = true;
                    yield encodeOpenAIChunk({ id, model: modelId, content: part.text });
                }
                if (part.type === 'error') throw part.error;
            }
            const finishReason = await result.finishReason;
            const usage = usageNumbers(await result.totalUsage);
            yield encodeOpenAIChunk({ id, model: modelId, finishReason });
            yield encodeOpenAIDone();
            await recordGatewayUsage({
                userId: ctx.userId,
                stateDir: dirs.stateDir,
                model: modelId,
                selection,
                ...usage,
                startedAt,
                fallbackUsed: index > 0,
                caller: 'ai-gateway:openai',
                system: normalized.system,
                promptText: normalized.promptText,
            });
            return;
        } catch (err) {
            lastError = err;
            if (emitted || classifyError(err) === 'fatal' || index >= selection.candidates.length - 1) break;
        }
    }
    throw toGatewayError(lastError);
}

export async function createAnthropicMessage(body: AnthropicMessagesRequest, ctx: GatewayCallContext): Promise<object> {
    const normalized = normalizeAnthropicRequest(body);
    const dirs = getUserDirs(ctx.userId);
    const selection = selectModels(normalized.model, normalized.promptText, ctx.allowFallback === true, Boolean(normalized.tools));
    if (selection.candidates.length === 0) {
        throw new GatewayError(400, 'provider_not_configured', 'No configured model is available for this request');
    }
    const startedAt = Date.now();
    const result = await generateWithSelectedModel({ ...normalized, selection, abortSignal: ctx.abortSignal });
    const usage = usageNumbers(result.usage);
    await recordGatewayUsage({
        userId: ctx.userId,
        stateDir: dirs.stateDir,
        model: result.modelId,
        selection,
        ...usage,
        startedAt,
        fallbackUsed: result.fallbackUsed,
        caller: 'ai-gateway:anthropic',
        system: normalized.system,
        promptText: normalized.promptText,
    });
    return encodeAnthropicMessage({
        id: `msg_${generateId()}`,
        model: result.modelId,
        content: anthropicContentFromParts(result.content, result.text),
        stopReason: mapAnthropicStopReason(result.finishReason),
        usage: { input_tokens: usage.promptTokens, output_tokens: usage.completionTokens },
    });
}

export async function* streamAnthropicMessage(body: AnthropicMessagesRequest, ctx: GatewayCallContext): AsyncGenerator<string> {
    const normalized = normalizeAnthropicRequest({ ...body, stream: true });
    const dirs = getUserDirs(ctx.userId);
    const selection = selectModels(normalized.model, normalized.promptText, ctx.allowFallback === true, Boolean(normalized.tools));
    const id = `msg_${generateId()}`;
    const startedAt = Date.now();
    let lastError: unknown;

    for (let index = 0; index < selection.candidates.length; index++) {
        const modelId = resolveModel(selection.candidates[index]);
        let emitted = false;
        let blockIndex = 0;
        let textBlockOpen = false;
        try {
            yield encodeAnthropicEvent('message_start', {
                type: 'message_start',
                message: { id, type: 'message', role: 'assistant', model: modelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
            });

            if (isAcpModel(modelId)) {
                if (normalized.tools) {
                    throw new GatewayError(400, 'unsupported_model_tools', 'Selected model does not support gateway tool declarations');
                }
                const text = await acpGenerate(acpPrompt(normalized.system, normalized.messages));
                if (text) {
                    yield encodeAnthropicEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
                    yield encodeAnthropicEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
                    yield encodeAnthropicEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
                }
                yield encodeAnthropicEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
                yield encodeAnthropicEvent('message_stop', { type: 'message_stop' });
                await recordGatewayUsage({
                    userId: ctx.userId,
                    stateDir: dirs.stateDir,
                    model: modelId,
                    selection,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    startedAt,
                    fallbackUsed: index > 0,
                    caller: 'ai-gateway:anthropic',
                    system: normalized.system,
                    promptText: normalized.promptText,
                });
                return;
            }

            const result = streamText({
                model: createLanguageModel(modelId),
                messages: normalized.messages,
                system: normalized.system,
                tools: normalized.tools,
                temperature: normalized.temperature,
                maxOutputTokens: normalized.maxOutputTokens,
                topP: normalized.topP,
                abortSignal: ctx.abortSignal,
                timeout: { chunkMs: STREAM_FIRST_CHUNK_TIMEOUT_MS },
            });
            for await (const part of result.fullStream) {
                if (part.type === 'text-delta') {
                    emitted = true;
                    if (!textBlockOpen) {
                        yield encodeAnthropicEvent('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
                        textBlockOpen = true;
                    }
                    yield encodeAnthropicEvent('content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: part.text } });
                }
                if (part.type === 'tool-call') {
                    emitted = true;
                    if (textBlockOpen) {
                        yield encodeAnthropicEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex });
                        blockIndex++;
                        textBlockOpen = false;
                    }
                    yield encodeAnthropicEvent('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: part.toolCallId, name: part.toolName, input: {} } });
                    yield encodeAnthropicEvent('content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(part.input ?? {}) } });
                    yield encodeAnthropicEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex });
                    blockIndex++;
                }
                if (part.type === 'error') throw part.error;
            }
            if (textBlockOpen) yield encodeAnthropicEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex });
            const finishReason = await result.finishReason;
            const usage = usageNumbers(await result.totalUsage);
            yield encodeAnthropicEvent('message_delta', { type: 'message_delta', delta: { stop_reason: mapAnthropicStopReason(finishReason), stop_sequence: null }, usage: { output_tokens: usage.completionTokens } });
            yield encodeAnthropicEvent('message_stop', { type: 'message_stop' });
            await recordGatewayUsage({
                userId: ctx.userId,
                stateDir: dirs.stateDir,
                model: modelId,
                selection,
                ...usage,
                startedAt,
                fallbackUsed: index > 0,
                caller: 'ai-gateway:anthropic',
                system: normalized.system,
                promptText: normalized.promptText,
            });
            return;
        } catch (err) {
            lastError = err;
            if (emitted || classifyError(err) === 'fatal' || index >= selection.candidates.length - 1) break;
        }
    }
    throw toGatewayError(lastError);
}