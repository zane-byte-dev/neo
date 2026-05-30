import { generateText, streamText, type FinishReason, type LanguageModelUsage, type ModelMessage, type ToolSet } from 'ai';
import { MODEL_ALIASES, GENERATE_TIMEOUT_MS, STREAM_FIRST_CHUNK_TIMEOUT_MS } from '../config.js';
import { appendUsageRecord, estimateCost } from '../llm/cost.js';
import { createLanguageModel, resolveModel } from '../llm/model-factory.js';
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
    abortSignal?: AbortSignal;
}

interface UserDirs {
    workDir: string;
    stateDir: string;
}

interface UsageMeta {
    userId: string;
    stateDir: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    startedAt: number;
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

// Virtual model IDs exposed to specific clients, mapped to real routing targets.
// e.g. Claude Desktop requires a 'claude-*' model ID in /v1/models to consider the gateway usable.
const VIRTUAL_ALIASES: Record<string, string> = {
    'claude-opus-4.7': 'deepseek',
};

function isKnownAlias(model: string): boolean {
    return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, model);
}

function isSupportedModelName(model: string): boolean {
    if (model === 'deepseek' || isKnownAlias(model)) return true;
    if (Object.values(MODEL_ALIASES).includes(model)) return true;
    return model.startsWith('deepseek');
}

/**
 * Resolve the requested model name to the single DeepSeek model used for all
 * requests. Validates that the requested name is a recognised alias.
 */
function selectModel(requestedModelRaw: string): { requestedModel: string; modelId: string } {
    const requestedModel = VIRTUAL_ALIASES[requestedModelRaw]
        ?? (requestedModelRaw.startsWith('claude-') ? 'deepseek' : requestedModelRaw);
    if (!isSupportedModelName(requestedModel)) {
        throw new GatewayError(404, 'unknown_model', `Unknown model: ${requestedModelRaw}`);
    }
    return { requestedModel, modelId: resolveModel('deepseek') };
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
        tier: 'standard',
        score: 0,
        confidence: 1,
        reason: 'fixed',
        promptTokens: meta.promptTokens,
        completionTokens: meta.completionTokens,
        totalTokens: meta.totalTokens,
        estimatedCost: estimateCost(meta.model, meta.promptTokens, meta.completionTokens),
        durationMs: Date.now() - meta.startedAt,
        fallbackUsed: false,
        caller: meta.caller,
        systemPrompt: meta.system,
        userPrompt: meta.promptText,
    }, meta.stateDir).catch(() => { /* never crash over tracking */ });
}

async function generateWithModel(args: {
    modelId: string;
    messages: ModelMessage[];
    system?: string;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    tools?: ToolSet;
    abortSignal?: AbortSignal;
}) {
    try {
        const result = await generateText({
            model: createLanguageModel(args.modelId),
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
            text: result.text,
            content: result.content,
            finishReason: result.finishReason,
            usage: result.totalUsage ?? result.usage,
        };
    } catch (err) {
        throw toGatewayError(err);
    }
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

function providerOwner(modelId: string): string {
    if (modelId.startsWith('deepseek')) return 'deepseek';
    return 'neo';
}

function modelListEntry(id: string, modelId: string, alias?: string): object {
    return {
        id,
        object: 'model',
        created: 1,
        owned_by: providerOwner(modelId),
        x_neo: { modelId, ...(alias ? { alias } : {}) },
    };
}

export async function getGatewayModels(options?: { claudeCompat?: boolean }): Promise<object> {
    const entries = new Map<string, object>();
    entries.set('deepseek', modelListEntry('deepseek', resolveModel('deepseek')));

    if (options?.claudeCompat) {
        entries.set('claude-opus-4.7', {
            id: 'claude-opus-4.7',
            object: 'model',
            created: 1,
            owned_by: 'anthropic',
            x_neo: { modelId: 'deepseek', virtual: true },
        });
    }

    for (const [alias, modelId] of Object.entries(MODEL_ALIASES)) {
        entries.set(alias, modelListEntry(alias, modelId, alias));
        if (modelId !== alias && !entries.has(modelId)) {
            entries.set(modelId, modelListEntry(modelId, modelId, alias));
        }
    }
    return { object: 'list', data: [...entries.values()] };
}

export async function createOpenAIChatCompletion(body: OpenAIChatRequest, ctx: GatewayCallContext): Promise<object> {
    const normalized = normalizeOpenAIRequest(body);
    const dirs = getUserDirs(ctx.userId);
    const { modelId } = selectModel(normalized.model);
    const startedAt = Date.now();
    const result = await generateWithModel({ ...normalized, modelId, abortSignal: ctx.abortSignal });
    const usage = usageNumbers(result.usage);
    await recordGatewayUsage({
        userId: ctx.userId,
        stateDir: dirs.stateDir,
        model: modelId,
        ...usage,
        startedAt,
        caller: 'ai-gateway:openai',
        system: normalized.system,
        promptText: normalized.promptText,
    });
    return encodeOpenAIChatCompletion({
        id: `chatcmpl-${generateId()}`,
        model: modelId,
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
    const { modelId } = selectModel(normalized.model);
    const id = `chatcmpl-${generateId()}`;
    const startedAt = Date.now();

    try {
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
            ...usage,
            startedAt,
            caller: 'ai-gateway:openai',
            system: normalized.system,
            promptText: normalized.promptText,
        });
    } catch (err) {
        throw toGatewayError(err);
    }
}

export function countAnthropicTokens(body: AnthropicMessagesRequest): object {
    const normalized = normalizeAnthropicRequest(body);
    const text = [normalized.system ?? '', normalized.promptText].join(' ');
    const inputTokens = Math.ceil(text.length / 4);
    return { input_tokens: inputTokens };
}

export async function createAnthropicMessage(body: AnthropicMessagesRequest, ctx: GatewayCallContext): Promise<object> {
    const normalized = normalizeAnthropicRequest(body);
    const dirs = getUserDirs(ctx.userId);
    const { modelId } = selectModel(normalized.model);
    const startedAt = Date.now();
    const result = await generateWithModel({ ...normalized, modelId, abortSignal: ctx.abortSignal });
    const usage = usageNumbers(result.usage);
    await recordGatewayUsage({
        userId: ctx.userId,
        stateDir: dirs.stateDir,
        model: modelId,
        ...usage,
        startedAt,
        caller: 'ai-gateway:anthropic',
        system: normalized.system,
        promptText: normalized.promptText,
    });
    return encodeAnthropicMessage({
        id: `msg_${generateId()}`,
        model: modelId,
        content: anthropicContentFromParts(result.content, result.text),
        stopReason: mapAnthropicStopReason(result.finishReason),
        usage: { input_tokens: usage.promptTokens, output_tokens: usage.completionTokens },
    });
}

export async function* streamAnthropicMessage(body: AnthropicMessagesRequest, ctx: GatewayCallContext): AsyncGenerator<string> {
    const normalized = normalizeAnthropicRequest({ ...body, stream: true });
    const dirs = getUserDirs(ctx.userId);
    const { modelId } = selectModel(normalized.model);
    const id = `msg_${generateId()}`;
    const startedAt = Date.now();
    let blockIndex = 0;
    let textBlockOpen = false;

    try {
        yield encodeAnthropicEvent('message_start', {
            type: 'message_start',
            message: { id, type: 'message', role: 'assistant', model: modelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
        });

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
                if (!textBlockOpen) {
                    yield encodeAnthropicEvent('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
                    textBlockOpen = true;
                }
                yield encodeAnthropicEvent('content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: part.text } });
            }
            if (part.type === 'tool-call') {
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
            ...usage,
            startedAt,
            caller: 'ai-gateway:anthropic',
            system: normalized.system,
            promptText: normalized.promptText,
        });
    } catch (err) {
        throw toGatewayError(err);
    }
}
