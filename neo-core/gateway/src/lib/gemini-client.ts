/**
 * gemini-client.ts — Self-contained Agent Runtime
 *
 * Replaces the gemini-cli ACP dependency with a direct Gemini REST API call +
 * agentic function-calling loop. No new npm packages required (uses native fetch).
 *
 * Same exported interface as before — telegram-bot.ts requires zero changes.
 *
 * Built-in tools available to the model:
 *   bash       — execute shell commands in workDir
 *   read_file  — read file contents
 *   write_file — write / create files
 *   list_dir   — list directory contents
 */

import { config } from 'dotenv';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { execa } from 'execa';
import { setupLogger } from './logger.js';

setupLogger();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

// ── Types (kept for backward compat with telegram-bot.ts) ────────────────────

export type StreamChunk =
    | { type: 'thought'; text: string }
    | { type: 'tool_call'; toolName: string }
    | { type: 'text'; text: string };

export type StreamCallback = (chunk: StreamChunk) => void;

// Kept so existing callers (chatAsyncWithContext signature) still compile.
export interface JSONRPCNotification {
    jsonrpc: '2.0';
    method: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any;
}

// ── Gemini REST API types ─────────────────────────────────────────────────────

type GeminiPart =
    | { text: string; thought?: boolean }
    | { functionCall: { name: string; args: Record<string, unknown>; thought_signature?: string } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { mimeType: string; fileUri: string } };

/** Image payload passed to the agent for vision tasks. */
export type ImageInput =
    | { type: 'inline'; mimeType: string; data: string }       // base64
    | { type: 'fileUri'; mimeType: string; fileUri: string };  // Gemini File API

/** Generic file attachment — same structure as ImageInput, covers PDF/audio/video too. */
export type FileInput = ImageInput;

interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required?: string[];
    };
}

// ── Skill registry ────────────────────────────────────────────────────────────

export interface Skill {
    declaration: FunctionDeclaration;
    handler: (args: Record<string, unknown>, workDir: string) => Promise<string>;
}

const skillRegistry = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
    skillRegistry.set(skill.declaration.name, skill);
    console.log(`[AgentRuntime] 🔧 Skill registered: ${skill.declaration.name}`);
}

// ── Built-in tool declarations ────────────────────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: 'bash',
        description:
            'Execute a shell command in the working directory. ' +
            'Use for file search, running scripts, git operations, web requests, etc.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                timeout_ms: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default 30000, max 120000)',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_file',
        description: 'Read the text contents of a file.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Absolute path, or path relative to the working directory',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write text content to a file, creating parent directories as needed.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (absolute or relative to workDir)' },
                content: { type: 'string', description: 'Text content to write' },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'list_dir',
        description: 'List the contents of a directory (directories shown first with trailing /).',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path (default: working directory)' },
            },
        },
    },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
    name: string,
    args: Record<string, unknown>,
    workDir: string,
): Promise<string> {
    console.log(`[AgentRuntime] Tool: ${name}(${JSON.stringify(args).slice(0, 120)})`);
    try {
        switch (name) {
            case 'bash': {
                const command = String(args.command ?? '');
                const timeoutMs = Math.min(Number(args.timeout_ms ?? 30_000), 120_000);
                const proc = await execa('sh', ['-c', command], {
                    cwd: workDir,
                    timeout: timeoutMs,
                    reject: false,
                    all: true,
                });
                const out = [
                    proc.stdout?.trim(),
                    proc.stderr?.trim() ? `[stderr]\n${proc.stderr.trim()}` : '',
                ]
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                return out || '(no output)';
            }

            case 'read_file': {
                const filePath = String(args.path ?? '');
                const resolved = isAbsolute(filePath) ? filePath : join(workDir, filePath);
                const content = await fs.readFile(resolved, 'utf8');
                // Guard against enormous files flooding the context window
                const LIMIT = 50_000;
                if (content.length > LIMIT) {
                    return (
                        content.slice(0, LIMIT) +
                        `\n\n[...truncated: ${content.length - LIMIT} additional chars omitted]`
                    );
                }
                return content;
            }

            case 'write_file': {
                const filePath = String(args.path ?? '');
                const content = String(args.content ?? '');
                const resolved = isAbsolute(filePath) ? filePath : join(workDir, filePath);
                await fs.mkdir(dirname(resolved), { recursive: true });
                await fs.writeFile(resolved, content, 'utf8');
                return `OK: wrote ${content.length} chars to ${resolved}`;
            }

            case 'list_dir': {
                const dirPath = String(args.path ?? '.');
                const resolved = isAbsolute(dirPath) ? dirPath : join(workDir, dirPath);
                const entries = await fs.readdir(resolved, { withFileTypes: true });
                const sorted = entries.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                return sorted.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
            }

            default: {
                const skill = skillRegistry.get(name);
                if (skill) return skill.handler(args, workDir);
                return `[Error] Unknown tool: ${name}`;
            }
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentRuntime] Tool error (${name}): ${msg}`);
        return `[Error] ${name} failed: ${msg}`;
    }
}

// ── Gemini SSE streaming ──────────────────────────────────────────────────────

interface ApiChunk {
    thought?: string;
    text?: string;
    functionCall?: { name: string; args: Record<string, unknown>; thoughtSignature?: string };
    /** The unmodified part object from the API — preserved for history reconstruction. */
    rawPart?: Record<string, unknown>;
}

/**
 * Resolve internal model aliases to real Gemini API model names.
 * (gemini-cli uses short aliases like "gemini-3-flash-preview")
 */
function resolveModel(model: string): string {
    const ALIASES: Record<string, string> = {
        // Short convenience aliases → real Gemini API model IDs
        'flash':   'gemini-3-flash-preview',
        'pro':     'gemini-3-pro-preview',
    };
    return ALIASES[model] ?? model;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_FILES_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

/**
 * Simple non-streaming generateContent call.
 * Returns the text of the first candidate, or null on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function geminiGenerate(
    apiKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contents: any[],
    options: { model?: string; generationConfig?: Record<string, unknown> } = {},
): Promise<string | null> {
    const model = resolveModel(options.model ?? 'flash');
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
    const body: Record<string, unknown> = { contents };
    if (options.generationConfig) body.generationConfig = options.generationConfig;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return (data.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() ?? null;
}

/**
 * Upload a file to the Gemini File API.
 * Returns the fileUri to reference in subsequent generateContent calls.
 */
export async function geminiUploadFile(
    apiKey: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    const res = await fetch(
        `${GEMINI_FILES_UPLOAD}?uploadType=media&key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': mimeType,
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Header-Content-Length': String(buffer.length),
            },
            body: buffer,
        }
    );
    if (!res.ok) throw new Error(`Gemini File API upload failed: ${res.status} ${await res.text()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const uri: string | undefined = data.file?.uri;
    if (!uri) throw new Error('No fileUri returned from Gemini File API');
    return uri;
}

async function* streamGeminiApi(
    apiKey: string,
    model: string,
    systemInstruction: string,
    contents: GeminiContent[],
): AsyncGenerator<ApiChunk> {
    const url = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.7 },
        tools: [{ functionDeclarations: [...TOOL_DECLARATIONS, ...Array.from(skillRegistry.values()).map(s => s.declaration)] }],
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

                    const parts: Array<Record<string, unknown>> =
                        json.candidates?.[0]?.content?.parts ?? [];

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

const MAX_TOOL_ITERATIONS = 15;

async function agentLoop(
    apiKey: string,
    model: string,
    systemInstruction: string,
    initialContents: GeminiContent[],
    workDir: string,
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
        // modelRawParts accumulates every part EXACTLY as received from the API.
        // This is critical for thinking models: thought parts and their associated
        // thought_signatures on functionCall parts must be round-tripped verbatim.
        const modelRawParts: Record<string, unknown>[] = [];
        const textParts: string[] = [];
        const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

        // Consume one full model turn from the streaming API
        for await (const chunk of streamGeminiApi(apiKey, model, systemInstruction, contents)) {
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
            functionCalls.map(fc => executeTool(fc.name, fc.args, workDir)),
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

// ── GeminiClient (same public interface as before) ────────────────────────────

export class GeminiClient {
    private enabled = false;
    private apiKey = '';
    private model = '';
    private workDir = '';
    private systemInstruction = '';

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY ?? '';
        this.model = resolveModel(process.env.GEMINI_MODEL ?? 'flash');
        this.workDir = process.env.WORK_DIR ?? '';

        if (!this.apiKey) {
            console.log('[AgentRuntime] ❌ Disabled: GEMINI_API_KEY not set');
            return;
        }
        if (!this.workDir) {
            console.log('[AgentRuntime] ❌ Disabled: WORK_DIR not set');
            return;
        }

        this.enabled = true;
        console.log(`[AgentRuntime] ✅ Initialized. Model: ${this.model}`);
        console.log(`[AgentRuntime] 📂 WorkDir: ${this.workDir}`);

        // Load system instruction in the background (non-blocking)
        this.loadSystemInstruction().then(si => {
            this.systemInstruction = si;
            if (si) {
                console.log(`[AgentRuntime] 📜 GEMINI.md loaded (${si.length} chars)`);
            } else {
                console.log('[AgentRuntime] ⚠️  No GEMINI.md found in workDir');
            }
        }).catch(err => console.error('[AgentRuntime] Failed to load GEMINI.md:', err.message));
    }

    private async loadSystemInstruction(): Promise<string> {
        const mdPath = join(this.workDir, 'GEMINI.md');
        try {
            return await fs.readFile(mdPath, 'utf8');
        } catch {
            return '';
        }
    }

    private buildPrompt(message: string, history?: string): string {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n\n`;
        if (history?.trim()) {
            prompt += `[Previous Conversation History]\n${history}\n\n`;
        }
        prompt += `[New Message]\n${message}`;
        return prompt;
    }

    private async runAgent(
        message: string,
        history?: string,
        onChunk?: StreamCallback,
        imageInput?: ImageInput,
    ): Promise<string | null> {
        if (!this.enabled) return null;

        const prompt = this.buildPrompt(message, history);
        const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }];

        try {
            const start = Date.now();
            console.log(`[AgentRuntime] → ${this.model}: ${message.slice(0, 60).replace(/\n/g, ' ')}${imageInput ? ' [+image]' : ''}...`);
            const result = await agentLoop(
                this.apiKey,
                this.model,
                this.systemInstruction,
                contents,
                this.workDir,
                onChunk,
                imageInput,
            );
            console.log(`[AgentRuntime] ✅ Done in ${Date.now() - start}ms`);
            return result || null;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[AgentRuntime] Error: ${msg}`);
            return `🔥 Agent error: ${msg}`;
        }
    }

    // ── Public API (same signatures as the old ACP-based GeminiClient) ────────

    async chatWithContextStreaming(
        message: string,
        conversationHistory: string,
        onChunk: StreamCallback,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk);
    }

    /** Multimodal variant — same as chatWithContextStreaming but attaches an image. */
    async chatWithContextStreamingWithImage(
        message: string,
        conversationHistory: string,
        imageInput: ImageInput,
        onChunk: StreamCallback,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, imageInput);
    }

    /** Same as WithImage but semantically for documents (PDF, audio, video via File API). */
    async chatWithContextStreamingWithFile(
        message: string,
        conversationHistory: string,
        fileInput: FileInput,
        onChunk: StreamCallback,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, fileInput);
    }

    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        return this.runAgent(message, conversationHistory);
    }

    async chat(message: string): Promise<string | null> {
        return this.runAgent(message);
    }

    /**
     * Async isolated task — same agentic loop, fresh context (no shared history).
     * The onEvent parameter is accepted for API compatibility but is unused.
     */
    async chatAsyncWithContext(
        message: string,
        _conversationHistory: string,
        _onEvent?: (msg: JSONRPCNotification) => { detach: boolean; result?: string },
    ): Promise<string | null> {
        return this.runAgent(message);
    }

    async runSkill(skillName: string, args: string[]): Promise<string | null> {
        const prompt =
            `Please execute the skill **${skillName}**.\n\n` +
            `Arguments: ${args.join(' ')}\n\n` +
            `(Skill file: system/skill/${skillName}.md)`;
        return this.runAgent(prompt);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    /** No-op: no subprocess to terminate. */
    close(): void {}
}

export function createGeminiClient(): GeminiClient {
    return new GeminiClient();
}

// ── Self-test when run directly ───────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
    const client = createGeminiClient();
    if (client.isEnabled()) {
        console.log('\n[Test] Sending a simple prompt...');
        const res = await client.chat('用一句话描述你现在的通信机制。');
        console.log('\n[Response]:', res);
        client.close();
    }
}
