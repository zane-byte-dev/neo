/**
 * gemini-client.ts — Gemini API client and skill registry.
 *
 * Sub-modules handle the heavy lifting:
 *   - gemini-types.ts  — shared type definitions
 *   - tool-executor.ts — built-in tool declarations & execution
 *   - agent-runtime.ts — SSE streaming & agentic tool-calling loop
 */

import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { setupLogger } from './logger.js';
import { GEMINI_BASE_URL, GEMINI_FILES_UPLOAD_URL } from '../config.js';
import { agentLoop, resolveModel } from './agent-runtime.js';

// Re-export all types for backward compatibility
export type {
    StreamChunk,
    StreamCallback,
    JSONRPCNotification,
    GeminiPart,
    ImageInput,
    FileInput,
    GeminiContent,
    FunctionDeclaration,
    SkillMeta,
    Skill,
} from './gemini-types.js';

import type {
    StreamCallback,
    ImageInput,
    FileInput,
    GeminiContent,
    Skill,
    JSONRPCNotification,
} from './gemini-types.js';

setupLogger();

// ── Skill registry ────────────────────────────────────────────────────────────

const skillRegistry = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
    skillRegistry.set(skill.declaration.name, skill);
    console.log(`[AgentRuntime] 🔧 Skill registered: ${skill.declaration.name}`);
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
        this.apiKey = process.env.GEMINI_API_KEY ?? '';
        this.model = resolveModel(process.env.GEMINI_MODEL ?? 'flash');
        // Always resolve to absolute path so tool calls work regardless of CWD
        const rawWorkDir = process.env.WORK_DIR ?? process.env.GEMINI_WORK_DIR ?? '';
        this.workDir = rawWorkDir ? resolve(rawWorkDir) : '';
        this.configDir = process.env.AGENT_CONFIG_DIR ? resolve(process.env.AGENT_CONFIG_DIR) : '';

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
        this.loadSystemInstruction().then(si => {
            this.systemInstruction = si;
            if (si) {
                console.log(`[AgentRuntime] 📜 agent.md loaded (${si.length} chars)`);
            } else {
                console.log('[AgentRuntime] ⚠️  No agent.md found');
            }
        }).catch(err => console.error('[AgentRuntime] Failed to load agent.md:', err.message));
    }

    private async loadSystemInstruction(): Promise<string> {
        const dirs = [this.configDir, this.workDir].filter(Boolean) as string[];

        // Try three-file system: AGENTS.md + SOUL.md (optional) + TOOLS.md (optional)
        for (const dir of dirs) {
            try {
                const agents = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8');
                const parts: string[] = [agents.trim()];
                for (const file of ['SOUL.md', 'TOOLS.md']) {
                    try {
                        const content = await fs.readFile(join(dir, file), 'utf8');
                        if (content.trim()) parts.push(content.trim());
                    } catch { /* optional */ }
                }
                const merged = parts.join('\n\n---\n\n');
                const fileList = ['AGENTS.md', 'SOUL.md', 'TOOLS.md'].slice(0, parts.length).join(' + ');
                console.log(`[AgentRuntime] 📜 Loaded prompt from: ${dir} (${fileList})`);
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
        if (!this.enabled) {
            console.warn(`[AgentRuntime] Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

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
                skillRegistry,
                onChunk,
                imageInput,
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
