/**
 * agent-runtime.ts — Gemini SSE streaming and agentic tool-calling loop.
 */

import { GEMINI_BASE_URL, MAX_TOOL_ITERATIONS, MODEL_ALIASES } from '../config.js';
import { executeTool, TOOL_DECLARATIONS } from './tool-executor.js';
import type {
    GeminiContent,
    GeminiPart,
    StreamCallback,
    ImageInput,
    Tool,
} from './gemini-types.js';

// ── Internal types ────────────────────────────────────────────────────────────

interface ApiChunk {
    thought?: string;
    text?: string;
    functionCall?: { name: string; args: Record<string, unknown>; thoughtSignature?: string };
    /** The unmodified part object from the API — preserved for history reconstruction. */
    rawPart?: Record<string, unknown>;
}

// ── Model resolver ────────────────────────────────────────────────────────────

/**
 * Resolve internal model aliases to real Gemini API model names.
 */
export function resolveModel(model: string): string {
    return MODEL_ALIASES[model] ?? model;
}

// ── Gemini SSE streaming ──────────────────────────────────────────────────────

async function* streamGeminiApi(
    apiKey: string,
    model: string,
    systemInstruction: string,
    contents: GeminiContent[],
    toolRegistry: Map<string, Tool>,
): AsyncGenerator<ApiChunk> {
    const url = `${GEMINI_BASE_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.7 },
        tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...Array.from(toolRegistry.values()).map(s => s.declaration)] }],
    };
    if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6).trim();
                if (!data || data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);

                    // Surface any server-side error embedded in the stream
                    if (json.error) {
                        throw new Error(
                            typeof json.error === 'object'
                                ? (json.error.message ?? JSON.stringify(json.error))
                                : String(json.error),
                        );
                    }

                    const candidate = json.candidates?.[0];
                    const finishReason: string | undefined = candidate?.finishReason;
                    if (finishReason && finishReason !== 'STOP') {
                        console.warn(`[Gemini] finishReason=${finishReason}`, candidate?.safetyRatings ?? '');
                    }

                    const parts: Array<Record<string, unknown>> =
                        candidate?.content?.parts ?? [];

                    for (const part of parts) {
                        if (part.thought && typeof part.text === 'string') {
                            yield { thought: part.text as string, rawPart: part };
                        } else if (part.functionCall) {
                            const fc = part.functionCall as { name: string; args?: Record<string, unknown>; thought_signature?: string };
                            yield { functionCall: { name: fc.name, args: fc.args ?? {}, thoughtSignature: fc.thought_signature }, rawPart: part };
                        } else if (typeof part.text === 'string' && part.text) {
                            yield { text: part.text as string, rawPart: part };
                        }
                    }
                } catch (parseErr: unknown) {
                    // Re-throw only real API errors; skip malformed SSE chunks
                    const msg = parseErr instanceof Error ? parseErr.message : '';
                    if (msg.startsWith('Gemini API')) throw parseErr;
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

// ── Agentic loop ─────────────────────────────────────────────────────────────

export async function agentLoop(
    apiKey: string,
    model: string,
    systemInstruction: string,
    initialContents: GeminiContent[],
    workDir: string,
    toolRegistry: Map<string, Tool>,
    onChunk?: StreamCallback,
    imageInput?: ImageInput,
): Promise<string> {
    // Inject image into the first user turn when provided
    if (imageInput && initialContents.length > 0 && initialContents[0].role === 'user') {
        const imagePart: GeminiPart =
            imageInput.type === 'inline'
                ? { inlineData: { mimeType: imageInput.mimeType, data: imageInput.data } }
                : { fileData: { mimeType: imageInput.mimeType, fileUri: imageInput.fileUri } };
        initialContents = [
            { ...initialContents[0], parts: [...initialContents[0].parts, imagePart] },
            ...initialContents.slice(1),
        ];
    }

    const contents: GeminiContent[] = [...initialContents];
    let finalText = '';

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        if (iter === MAX_TOOL_ITERATIONS - 1) {
            console.warn(`[AgentRuntime] Reached MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}), forcing stop`);
        }
        // modelRawParts accumulates every part EXACTLY as received from the API.
        // This is critical for thinking models: thought parts and their associated
        // thought_signatures on functionCall parts must be round-tripped verbatim.
        const modelRawParts: Record<string, unknown>[] = [];
        const textParts: string[] = [];
        const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

        // Consume one full model turn from the streaming API
        for await (const chunk of streamGeminiApi(apiKey, model, systemInstruction, contents, toolRegistry)) {
            if (chunk.rawPart) modelRawParts.push(chunk.rawPart);
            if (chunk.thought) {
                // Thinking tokens: stream immediately — always safe to show live
                onChunk?.({ type: 'thought', text: chunk.thought });
            } else if (chunk.functionCall) {
                functionCalls.push({ name: chunk.functionCall.name, args: chunk.functionCall.args });
            } else if (chunk.text) {
                textParts.push(chunk.text);
            }
        }

        const turnText = textParts.join('');

        if (functionCalls.length === 0) {
            // ── Final turn: no more tool calls ──────────────────────────────
            finalText = turnText;
            if (turnText) {
                onChunk?.({ type: 'text', text: turnText });
            } else {
                console.warn(`[AgentRuntime] Empty text turn at iter=${iter}, rawParts=${JSON.stringify(modelRawParts).slice(0, 300)}`);
            }
            break;
        }

        // ── Intermediate turn: model wants to call tools ─────────────────────
        // Text before tool calls is "thinking aloud" — show as thought
        if (turnText) {
            onChunk?.({ type: 'thought', text: turnText });
        }
        for (const fc of functionCalls) {
            onChunk?.({ type: 'tool_call', toolName: fc.name });
        }

        // Record the model turn using raw parts to preserve thought parts and
        // thought_signatures required by the Gemini thinking model.
        contents.push({ role: 'model', parts: modelRawParts as GeminiPart[] });

        // Execute all tools (parallel for speed)
        const results = await Promise.all(
            functionCalls.map(fc => executeTool(fc.name, fc.args, workDir, toolRegistry)),
        );

        // Add function responses
        contents.push({
            role: 'user',
            parts: functionCalls.map((fc, i) => ({
                functionResponse: { name: fc.name, response: { output: results[i] } },
            })),
        });
    }

    return finalText;
}
