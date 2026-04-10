/**
 * src/llm/providers/gemini/index.ts — Gemini implementation of LLMProvider.
 *
 * Encapsulates:
 *   - Model alias resolution
 *   - SSE streaming (streamGeminiApi)
 *   - Agentic tool-calling loop (agentLoop)
 *   - Single-shot generation (generate / geminiGenerate)
 *   - File upload (uploadFile / geminiUploadFile)
 */

import { GEMINI_BASE_URL, GEMINI_FILES_UPLOAD_URL, GEMINI_API_TIMEOUT_MS, MAX_TOOL_ITERATIONS, MODEL_ALIASES } from '../../../config.js';
import { executeTool, TOOL_DECLARATIONS } from '../../../tools/executor.js';
import { dbg } from '../../../utils/debug-logger.js';
import type { LLMProvider, AgentLoopParams, GenerateParams } from '../../provider.js';
import type {
    GeminiContent,
    GeminiPart,
    StreamCallback,
    Tool,
    ToolContext,
    ImageInput,
} from '../../types.js';

// ── Internal streaming chunk type ─────────────────────────────────────────────

interface ApiChunk {
    thought?: string;
    text?: string;
    functionCall?: { name: string; args: Record<string, unknown>; thoughtSignature?: string };
    rawPart?: Record<string, unknown>;
}

// ── Model resolver ────────────────────────────────────────────────────────────

/** Resolve internal model aliases to real Gemini API model names. */
export function resolveModel(model: string): string {
    return MODEL_ALIASES[model] ?? model;
}

// ── SSE streaming ─────────────────────────────────────────────────────────────

async function* streamGeminiApi(
    apiKey: string,
    model: string,
    systemInstruction: string,
    contents: GeminiContent[],
    toolRegistry: Map<string, Tool>,
    forceText = false,
    signal?: AbortSignal,
): AsyncGenerator<ApiChunk> {
    const url = `${GEMINI_BASE_URL}/${model}:streamGenerateContent?alt=sse`;

    const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.7 },
    };
    if (!forceText) {
        body.tools = [{ functionDeclarations: [...TOOL_DECLARATIONS, ...Array.from(toolRegistry.values()).map(s => s.declaration)] }];
    }
    if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const timeoutSignal = AbortSignal.timeout(GEMINI_API_TIMEOUT_MS);
    const fetchSignal = signal
        ? AbortSignal.any([timeoutSignal, signal])
        : timeoutSignal;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: fetchSignal,
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

                    const parts: Array<Record<string, unknown>> = candidate?.content?.parts ?? [];

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
                    const msg = parseErr instanceof Error ? parseErr.message : '';
                    if (msg.startsWith('Gemini API')) throw parseErr;
                }
            }
        }
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'TimeoutError') {
            throw new Error(`Gemini API timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        reader.releaseLock();
    }
}

// ── Agentic loop (standalone export for direct callers) ───────────────────────

export async function agentLoop(
    apiKey: string,
    model: string,
    systemInstruction: string,
    initialContents: GeminiContent[],
    workDir: string,
    toolRegistry: Map<string, Tool>,
    onChunk?: StreamCallback,
    imageInput?: ImageInput,
    signal?: AbortSignal,
    context?: ToolContext,
): Promise<string> {
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

    const lastUserEntry = [...initialContents].reverse().find((c: GeminiContent) => c.role === 'user');
    const lastUserParts = lastUserEntry?.parts ?? [];
    const lastUserMsg = lastUserParts.map((p: GeminiPart) => ('text' in p && typeof p.text === 'string') ? p.text : '').join(' ');
    dbg.agentStart(model, initialContents.length, lastUserMsg);

    for (let iter = 0; iter <= MAX_TOOL_ITERATIONS; iter++) {
        const isLastIter = iter === MAX_TOOL_ITERATIONS;
        if (isLastIter) {
            console.warn(`[AgentRuntime] Reached MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}), forcing text response`);
        }

        const modelRawParts: Record<string, unknown>[] = [];
        const textParts: string[] = [];
        const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

        dbg.apiRequest(iter, model, contents);
        if (signal?.aborted) throw Object.assign(new Error('AbortError'), { name: 'AbortError' });

        try {
            for await (const chunk of streamGeminiApi(apiKey, model, systemInstruction, contents, toolRegistry, isLastIter, signal)) {
                if (chunk.rawPart) modelRawParts.push(chunk.rawPart);
                if (chunk.thought) {
                    onChunk?.({ type: 'thought', text: chunk.thought });
                    dbg.thought(iter, chunk.thought);
                } else if (chunk.functionCall) {
                    functionCalls.push({ name: chunk.functionCall.name, args: chunk.functionCall.args });
                } else if (chunk.text) {
                    textParts.push(chunk.text);
                }
            }
        } catch (err) {
            dbg.apiError(iter, err);
            throw err;
        }

        const turnText = textParts.join('');

        if (functionCalls.length === 0 || isLastIter) {
            finalText = turnText;
            if (turnText) {
                onChunk?.({ type: 'text', text: turnText });
                dbg.modelText(iter, turnText);
            } else {
                console.warn(`[AgentRuntime] Empty text turn at iter=${iter}, rawParts=${JSON.stringify(modelRawParts).slice(0, 300)}`);
            }
            dbg.agentDone(iter, turnText.length);
            break;
        }

        if (turnText) {
            onChunk?.({ type: 'thought', text: turnText });
        }
        for (const fc of functionCalls) {
            onChunk?.({ type: 'tool_call', toolName: fc.name, args: fc.args });
        }

        contents.push({ role: 'model', parts: modelRawParts as GeminiPart[] });

        for (const fc of functionCalls) {
            dbg.toolCall(iter, fc.name, fc.args);
        }

        const results = await Promise.all(
            functionCalls.map(fc => executeTool(fc.name, fc.args, workDir, toolRegistry, context)),
        );

        for (let i = 0; i < functionCalls.length; i++) {
            dbg.toolResult(iter, functionCalls[i].name, String(results[i]));
        }

        contents.push({
            role: 'user',
            parts: functionCalls.map((fc, i) => ({
                functionResponse: { name: fc.name, response: { output: results[i] } },
            })),
        });
    }

    return finalText;
}

// ── Single-shot generation ────────────────────────────────────────────────────

export async function geminiGenerate(
    apiKey: string,
    contents: GeminiContent[],
    options: { model?: string; generationConfig?: Record<string, unknown> } = {},
): Promise<string | null> {
    const model = resolveModel(options.model ?? 'flash');
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
    const body: Record<string, unknown> = { contents };
    if (options.generationConfig) body.generationConfig = options.generationConfig;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

// ── File upload ───────────────────────────────────────────────────────────────

export async function geminiUploadFile(
    apiKey: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    const res = await fetch(
        `${GEMINI_FILES_UPLOAD_URL}?uploadType=media`,
        {
            method: 'POST',
            headers: {
                'Content-Type': mimeType,
                'x-goog-api-key': apiKey,
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Header-Content-Length': String(buffer.length),
            },
            body: buffer,
        },
    );
    if (!res.ok) throw new Error(`Gemini File API upload failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { file?: { uri?: string } };
    const uri: string | undefined = data.file?.uri;
    if (!uri) throw new Error('No fileUri returned from Gemini File API');
    return uri;
}

// ── GeminiProvider class ──────────────────────────────────────────────────────

export class GeminiProvider implements LLMProvider {
    readonly name = 'gemini';

    resolveModel(alias: string): string {
        return resolveModel(alias);
    }

    async agentLoop(params: AgentLoopParams): Promise<string> {
        return agentLoop(
            params.apiKey,
            params.model,
            params.systemInstruction,
            params.contents,
            params.workDir,
            params.toolRegistry,
            params.onChunk,
            params.imageInput,
            params.signal,
            params.context,
        );
    }

    async generate(params: GenerateParams): Promise<string | null> {
        return geminiGenerate(params.apiKey, params.contents, {
            model: params.model,
            generationConfig: params.generationConfig,
        });
    }

    async uploadFile(apiKey: string, buffer: Buffer, mimeType: string): Promise<string> {
        return geminiUploadFile(apiKey, buffer, mimeType);
    }
}
