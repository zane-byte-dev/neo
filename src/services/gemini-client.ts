/**
 * gemini-client.ts — Gemini API client and tool registry.
 *
 * Sub-modules handle the heavy lifting:
 *   - gemini-types.ts  — shared type definitions
 *   - tool-executor.ts — built-in tool declarations & execution
 *   - agent-runtime.ts — SSE streaming & agentic tool-calling loop
 */

import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { setupLogger } from '../utils/logger.js';
import { GEMINI_BASE_URL, GEMINI_FILES_UPLOAD_URL, GEMINI_API_KEY, GEMINI_MODEL_ENV, WORK_DIR, GEMINI_WORK_DIR, AGENT_CONFIG_DIR } from '../config.js';
import { agentLoop, resolveModel } from './agent-runtime.js';
import { loadOpenClawSkills, formatSkillsPrompt } from './openclaw-skills.js';

export type {
    StreamChunk,
    StreamCallback,
    GeminiPart,
    ImageInput,
    FileInput,
    GeminiContent,
    FunctionDeclaration,
    ToolMeta,
    Tool,
} from '../utils/gemini-types.js';

import type {
    StreamCallback,
    ImageInput,
    FileInput,
    GeminiContent,
    Tool,
} from '../utils/gemini-types.js';

setupLogger();

// ── Tool registry ─────────────────────────────────────────────────────────────────

const toolRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    toolRegistry.set(tool.declaration.name, tool);
    console.log(`[AgentRuntime] 🔧 Tool registered: ${tool.declaration.name}`);
}

// ── Simple (non-streaming) API calls ──────────────────────────────────────────

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
    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;
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
        `${GEMINI_FILES_UPLOAD_URL}?uploadType=media&key=${apiKey}`,
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

// ── GeminiClient ─────────────────────────────────────────────────────────────

export class GeminiClient {
    private enabled = false;
    private apiKey = '';
    private model = '';
    private workDir = '';
    private configDir = '';
    private systemInstruction = '';

    constructor() {
        this.apiKey = GEMINI_API_KEY;
        this.model = resolveModel(GEMINI_MODEL_ENV ?? 'flash');
        // Always resolve to absolute path so tool calls work regardless of CWD
        const rawWorkDir = WORK_DIR || GEMINI_WORK_DIR;
        this.workDir = rawWorkDir ? resolve(rawWorkDir) : '';
        this.configDir = AGENT_CONFIG_DIR;

        if (!this.apiKey) {
            console.log('[AgentRuntime] ❌ Disabled: GEMINI_API_KEY not set');
            return;
        }
        if (!this.workDir) {
            console.log('[AgentRuntime] ❌ Disabled: WORK_DIR (or GEMINI_WORK_DIR) not set');
            return;
        }

        this.enabled = true;
        console.log(`[AgentRuntime] ✅ Initialized. Model: ${this.model}`);
        console.log(`[AgentRuntime] 📂 WorkDir: ${this.workDir}`);
        if (this.configDir) console.log(`[AgentRuntime] ⚙️  ConfigDir: ${this.configDir}`);

        // Load system instruction in the background (non-blocking)
        this.loadSystemInstruction().then(async si => {
            const parts: string[] = [];
            if (si) parts.push(si);

            // Append OpenClaw skills
            const skillsPrompt = await this.loadOpenClawSkills();
            if (skillsPrompt) parts.push(skillsPrompt);

            this.systemInstruction = parts.join('\n\n---\n\n');

            if (this.systemInstruction) {
                console.log(`[AgentRuntime] 📜 System instruction ready (${this.systemInstruction.length} chars)`);
            } else {
                console.log('[AgentRuntime] ⚠️  No system instruction loaded');
            }
        }).catch(err => console.error('[AgentRuntime] Failed to load system instruction:', err.message));
    }

    private async loadSystemInstruction(): Promise<string> {
        const dirs = [this.configDir, this.workDir].filter(Boolean) as string[];

        // Try three-file system: AGENTS.md + SOUL.md (optional) + TOOLS.md (optional)
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
                console.log(`[AgentRuntime] 📜 Loaded prompt from: ${dir} (${loadedFiles.join(' + ')})`)
                return merged;
            } catch { /* try next dir */ }
        }

        // Backward compat: single agent.md
        for (const dir of dirs) {
            try {
                const content = await fs.readFile(join(dir, 'agent.md'), 'utf8');
                console.log(`[AgentRuntime] 📜 Loaded agent.md from: ${dir}`);
                return content;
            } catch { /* try next */ }
        }
        return '';
    }

    /**
     * Discover and load OpenClaw skills, returning a formatted prompt section.
     */
    private async loadOpenClawSkills(): Promise<string> {
        try {
            const skills = await loadOpenClawSkills();
            if (skills.length === 0) return '';
            const prompt = formatSkillsPrompt(skills);
            console.log(`[AgentRuntime] 🧩 OpenClaw: ${skills.length} skill(s) loaded — ${skills.map(s => s.name).join(', ')}`);
            return prompt;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[AgentRuntime] ⚠️  OpenClaw skills load failed: ${msg}`);
            return '';
        }
    }

    private async buildPrompt(message: string, history?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

        // Inject NOW.md (Short-term memory / Workbench)
        try {
            const nowMdPath = join(this.workDir, 'memory', 'NOW.md');
            const nowMd = await fs.readFile(nowMdPath, 'utf8');
            if (nowMd.trim()) {
                prompt += `\n[Current Mission/Focus]\n${nowMd.trim()}\n`;
            }
        } catch {
            // NOW.md not found or unreadable, skip
        }

        if (history?.trim()) {
            prompt += `\n[Previous Conversation History]\n${history}\n`;
        }
        prompt += `\n[New Message]\n${message}`;
        return prompt;
    }

    private async runAgent(
        message: string,
        history?: string,
        onChunk?: StreamCallback,
        imageInput?: ImageInput,
        signal?: AbortSignal,
    ): Promise<string | null> {
        if (!this.enabled) {
            console.warn(`[AgentRuntime] Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

        const prompt = await this.buildPrompt(message, history);
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
                toolRegistry,
                onChunk,
                imageInput,
                signal,
            );
            const elapsed = Date.now() - start;
            if (!result) {
                console.warn(`[AgentRuntime] Empty result after ${elapsed}ms for: ${message.slice(0, 80).replace(/\n/g, ' ')}`);
            } else {
                console.log(`[AgentRuntime] ✅ Done in ${elapsed}ms, response length=${result.length}`);
            }
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
        signal?: AbortSignal,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, undefined, signal);
    }

    /** Multimodal variant — same as chatWithContextStreaming but attaches an image. */
    async chatWithContextStreamingWithImage(
        message: string,
        conversationHistory: string,
        imageInput: ImageInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, imageInput, signal);
    }

    /** Same as WithImage but semantically for documents (PDF, audio, video via File API). */
    async chatWithContextStreamingWithFile(
        message: string,
        conversationHistory: string,
        fileInput: FileInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, fileInput, signal);
    }

    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        return this.runAgent(message, conversationHistory);
    }

    async chat(message: string): Promise<string | null> {
        return this.runAgent(message);
    }

    /**
     * Async isolated task — same agentic loop, fresh context (no shared history).
     */
    async chatAsyncWithContext(message: string): Promise<string | null> {
        return this.runAgent(message);
    }

    async runTool(toolName: string, args: string[]): Promise<string | null> {
        const prompt =
            `Please execute the tool **${toolName}**.\n\n` +
            `Arguments: ${args.join(' ')}\n\n` +
            `(Tool: ${toolName})`;
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
