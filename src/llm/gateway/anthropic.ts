import type { ModelMessage, ToolSet } from 'ai';
import { jsonSchema, tool } from 'ai';
import { GatewayError } from './errors.js';

export interface AnthropicMessagesRequest {
    model?: string;
    system?: unknown;
    messages?: unknown;
    tools?: unknown;
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
}

export interface AnthropicContentBlock {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
}

export interface NormalizedAnthropicRequest {
    model: string;
    system?: string;
    messages: ModelMessage[];
    tools?: ToolSet;
    stream: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    promptText: string;
}

function textFromContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) {
        throw new GatewayError(400, 'unsupported_content', 'Only text content is supported');
    }
    return content.map((part) => {
        if (!part || typeof part !== 'object') {
            throw new GatewayError(400, 'unsupported_content_part', 'Unsupported content part');
        }
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        throw new GatewayError(400, 'unsupported_content_part', 'Only text content parts are supported here');
    }).join('');
}

function systemToText(system: unknown): string | undefined {
    if (system === undefined || system === null) return undefined;
    if (typeof system === 'string') return system;
    if (Array.isArray(system)) return textFromContent(system);
    throw new GatewayError(400, 'invalid_system', 'system must be a string or text block array');
}

function readNumber(value: unknown, code: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new GatewayError(400, code, 'Numeric generation parameter is invalid');
    }
    return value;
}

function normalizeTools(rawTools: unknown): ToolSet | undefined {
    if (rawTools === undefined || rawTools === null) return undefined;
    if (!Array.isArray(rawTools)) {
        throw new GatewayError(400, 'invalid_tools', 'tools must be an array');
    }
    const tools: ToolSet = {};
    for (const raw of rawTools) {
        if (!raw || typeof raw !== 'object') {
            throw new GatewayError(400, 'invalid_tool', 'Each tool must be an object');
        }
        const t = raw as { name?: unknown; description?: unknown; input_schema?: unknown };
        if (typeof t.name !== 'string' || !t.name.trim()) {
            throw new GatewayError(400, 'invalid_tool', 'Tool name is required');
        }
        if (!t.input_schema || typeof t.input_schema !== 'object') {
            throw new GatewayError(400, 'invalid_tool_schema', 'Tool input_schema is required');
        }
        tools[t.name] = tool({
            description: typeof t.description === 'string' ? t.description : undefined,
            inputSchema: jsonSchema(t.input_schema as Record<string, unknown>),
        });
    }
    return Object.keys(tools).length ? tools : undefined;
}

function normalizeToolResultContent(content: unknown): { type: 'text'; value: string } {
    if (typeof content === 'string') return { type: 'text', value: content };
    if (Array.isArray(content)) {
        const text = content.map((part) => {
            if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
                const value = (part as { text?: unknown }).text;
                return typeof value === 'string' ? value : '';
            }
            return JSON.stringify(part);
        }).join('');
        return { type: 'text', value: text };
    }
    return { type: 'text', value: JSON.stringify(content) };
}

export function normalizeAnthropicRequest(body: AnthropicMessagesRequest): NormalizedAnthropicRequest {
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'auto';
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw new GatewayError(400, 'invalid_messages', 'messages must be a non-empty array');
    }

    const messages: ModelMessage[] = [];
    const promptParts: string[] = [];
    const toolNames = new Map<string, string>();

    for (const raw of body.messages) {
        if (!raw || typeof raw !== 'object') {
            throw new GatewayError(400, 'invalid_message', 'Each message must be an object');
        }
        const msg = raw as { role?: unknown; content?: unknown };
        if (msg.role !== 'user' && msg.role !== 'assistant') {
            throw new GatewayError(400, 'unsupported_role', 'Only user and assistant messages are supported');
        }

        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
            promptParts.push(`${msg.role}: ${msg.content}`);
            continue;
        }
        if (!Array.isArray(msg.content)) {
            throw new GatewayError(400, 'unsupported_content', 'Message content must be text or an array');
        }

        const userTextParts: Array<{ type: 'text'; text: string }> = [];
        const assistantParts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }> = [];
        const toolResults: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }> = [];

        for (const part of msg.content) {
            if (!part || typeof part !== 'object') {
                throw new GatewayError(400, 'unsupported_content_part', 'Unsupported content part');
            }
            const p = part as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown };
            if (p.type === 'text' && typeof p.text === 'string') {
                if (msg.role === 'assistant') assistantParts.push({ type: 'text', text: p.text });
                else userTextParts.push({ type: 'text', text: p.text });
                promptParts.push(`${msg.role}: ${p.text}`);
                continue;
            }
            if (msg.role === 'assistant' && p.type === 'tool_use' && typeof p.id === 'string' && typeof p.name === 'string') {
                toolNames.set(p.id, p.name);
                assistantParts.push({ type: 'tool-call', toolCallId: p.id, toolName: p.name, input: p.input ?? {} });
                promptParts.push(`assistant tool_use ${p.name}`);
                continue;
            }
            if (msg.role === 'user' && p.type === 'tool_result' && typeof p.tool_use_id === 'string') {
                const toolName = toolNames.get(p.tool_use_id) ?? 'tool_result';
                toolResults.push({
                    type: 'tool-result',
                    toolCallId: p.tool_use_id,
                    toolName,
                    output: normalizeToolResultContent(p.content),
                });
                promptParts.push(`user tool_result ${toolName}`);
                continue;
            }
            throw new GatewayError(400, 'unsupported_content_part', 'Unsupported Anthropic content part');
        }

        if (assistantParts.length > 0) messages.push({ role: 'assistant', content: assistantParts });
        if (toolResults.length > 0) messages.push({ role: 'tool', content: toolResults } as ModelMessage);
        if (userTextParts.length > 0) messages.push({ role: 'user', content: userTextParts });
    }

    return {
        model,
        system: systemToText(body.system),
        messages,
        tools: normalizeTools(body.tools),
        stream: body.stream === true,
        temperature: readNumber(body.temperature, 'invalid_temperature'),
        maxOutputTokens: readNumber(body.max_tokens, 'invalid_max_tokens'),
        topP: readNumber(body.top_p, 'invalid_top_p'),
        promptText: promptParts.join('\n'),
    };
}

export function encodeAnthropicMessage(args: {
    id: string;
    model: string;
    content: AnthropicContentBlock[];
    stopReason: string | null;
    usage: { input_tokens: number; output_tokens: number };
}): object {
    return {
        id: args.id,
        type: 'message',
        role: 'assistant',
        model: args.model,
        content: args.content,
        stop_reason: args.stopReason,
        stop_sequence: null,
        usage: args.usage,
    };
}

export function encodeAnthropicEvent(event: string, data: object): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function encodeAnthropicError(err: GatewayError): object {
    return {
        type: 'error',
        error: {
            type: err.code,
            message: err.message,
        },
    };
}

export function encodeAnthropicErrorEvent(err: GatewayError): string {
    return encodeAnthropicEvent('error', encodeAnthropicError(err));
}

export function mapAnthropicStopReason(reason: string): string | null {
    if (reason === 'length') return 'max_tokens';
    if (reason === 'tool-calls') return 'tool_use';
    if (reason === 'stop') return 'end_turn';
    return reason ? 'end_turn' : null;
}