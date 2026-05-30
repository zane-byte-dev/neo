import type { ModelMessage } from 'ai';
import { GatewayError } from './errors.js';

export interface OpenAIChatRequest {
    model?: string;
    messages?: unknown;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    tools?: unknown;
    tool_choice?: unknown;
}

export interface NormalizedOpenAIRequest {
    model: string;
    system?: string;
    messages: ModelMessage[];
    stream: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    promptText: string;
}

export interface OpenAIUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface OpenAIChoiceMessage {
    role: 'assistant';
    content: string | null;
}

function readTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) {
        throw new GatewayError(400, 'unsupported_content', 'Only text message content is supported');
    }
    const parts: string[] = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') {
            throw new GatewayError(400, 'unsupported_content_part', 'Unsupported content part');
        }
        const p = part as { type?: unknown; text?: unknown };
        if ((p.type === 'text' || p.type === 'input_text' || p.type === 'output_text') && typeof p.text === 'string') {
            parts.push(p.text);
            continue;
        }
        throw new GatewayError(400, 'unsupported_content_part', 'Only text content parts are supported');
    }
    return parts.join('');
}

function readNumber(value: unknown, code: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new GatewayError(400, code, 'Numeric generation parameter is invalid');
    }
    return value;
}

export function normalizeOpenAIRequest(body: OpenAIChatRequest): NormalizedOpenAIRequest {
    if (body.tools !== undefined || body.tool_choice !== undefined) {
        throw new GatewayError(400, 'unsupported_tools', 'OpenAI tool calling is not supported by the gateway MVP');
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'auto';
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw new GatewayError(400, 'invalid_messages', 'messages must be a non-empty array');
    }

    const systemParts: string[] = [];
    const messages: ModelMessage[] = [];
    const promptParts: string[] = [];

    for (const raw of body.messages) {
        if (!raw || typeof raw !== 'object') {
            throw new GatewayError(400, 'invalid_message', 'Each message must be an object');
        }
        const msg = raw as { role?: unknown; content?: unknown };
        if (msg.role !== 'system' && msg.role !== 'user' && msg.role !== 'assistant') {
            throw new GatewayError(400, 'unsupported_role', 'Only system, user, and assistant messages are supported');
        }
        const text = readTextContent(msg.content);
        if (msg.role === 'system') {
            systemParts.push(text);
        } else {
            messages.push({ role: msg.role, content: text });
            promptParts.push(`${msg.role}: ${text}`);
        }
    }

    if (messages.length === 0) {
        throw new GatewayError(400, 'invalid_messages', 'At least one non-system message is required');
    }

    return {
        model,
        system: systemParts.length ? systemParts.join('\n\n') : undefined,
        messages,
        stream: body.stream === true,
        temperature: readNumber(body.temperature, 'invalid_temperature'),
        maxOutputTokens: readNumber(body.max_tokens, 'invalid_max_tokens'),
        topP: readNumber(body.top_p, 'invalid_top_p'),
        promptText: promptParts.join('\n'),
    };
}

export function encodeOpenAIChatCompletion(args: {
    id: string;
    model: string;
    content: string;
    finishReason: string;
    usage: OpenAIUsage;
}): object {
    return {
        id: args.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: args.model,
        choices: [{
            index: 0,
            message: { role: 'assistant', content: args.content },
            finish_reason: mapOpenAIFinishReason(args.finishReason),
        }],
        usage: args.usage,
    };
}

export function encodeOpenAIChunk(args: { id: string; model: string; content?: string; finishReason?: string }): string {
    const choice = args.content !== undefined
        ? { index: 0, delta: { content: args.content }, finish_reason: null }
        : { index: 0, delta: {}, finish_reason: mapOpenAIFinishReason(args.finishReason ?? 'stop') };
    return `data: ${JSON.stringify({
        id: args.id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: args.model,
        choices: [choice],
    })}\n\n`;
}

export function encodeOpenAIDone(): string {
    return 'data: [DONE]\n\n';
}

export function encodeOpenAIError(err: GatewayError): object {
    return {
        error: {
            message: err.message,
            type: err.type,
            code: err.code,
        },
    };
}

export function encodeOpenAIErrorEvent(err: GatewayError): string {
    return `data: ${JSON.stringify(encodeOpenAIError(err))}\n\n${encodeOpenAIDone()}`;
}

function mapOpenAIFinishReason(reason: string): string {
    if (reason === 'length') return 'length';
    if (reason === 'content-filter') return 'content_filter';
    if (reason === 'tool-calls') return 'tool_calls';
    if (reason === 'error') return 'error';
    return 'stop';
}