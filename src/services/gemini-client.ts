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
    ToolContext,
} from '../utils/gemini-types.js';

import type {
    StreamCallback,
    ImageInput,
    FileInput,
    GeminiContent,
    Tool,
    ToolContext,
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

/**
 * Load system instruction from a config directory.
 * Reads AGENTS.md (required) + optional SOUL.md, TOOLS.md, XIFENG.md.
 * Falls back to legacy agent.md if AGENTS.md not found.
 *
 * @param configDir  Absolute path to a config directory to search.
 * @param fallbackDirs  Additional directories to search (in order).
 */
export async function loadSystemInstruction(configDir: string, ...fallbackDirs: string[]): Promise<string> {
    const dirs = [configDir, ...fallbackDirs].filter(Boolean);

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
            console.log(`[AgentRuntime] 📜 Loaded prompt from: ${dir} (${loadedFiles.join(' + ')})`);
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
 * Build the full system instruction for a tenant, combining:
 * 1. Config files (AGENTS.md, SOUL.md, etc.)
 * 2. Workspace skills (from {workDir}/config/skills/)
 * 3. Global OpenClaw skills (from ~/.openclaw/workspace/skills/)
 */
export async function buildTenantSystemInstruction(workDir: string): Promise<string> {
    const configDir = join(workDir, 'config');
    const parts: string[] = [];

    // 1. Load config md files
    const si = await loadSystemInstruction(configDir);
    if (si) parts.push(si);

    // 2. Load workspace skills ({workDir}/config/skills/)
    const workspaceSkills = await loadOpenClawSkills(join(configDir, 'skills'));
    if (workspaceSkills.length > 0) {
        parts.push(formatSkillsPrompt(workspaceSkills));
        console.log(`[AgentRuntime] 🧩 Workspace skills: ${workspaceSkills.length} — ${workspaceSkills.map(s => s.name).join(', ')}`);
    }

    // 3. Load global OpenClaw skills
    const globalSkills = await loadOpenClawSkills();
    if (globalSkills.length > 0) {
        parts.push(formatSkillsPrompt(globalSkills));
        console.log(`[AgentRuntime] 🧩 OpenClaw skills: ${globalSkills.length} — ${globalSkills.map(s => s.name).join(', ')}`);
    }

    return parts.join('\n\n---\n\n');
}

export class GeminiClient {
    private enabled = false;
    private apiKey = '';
    private model = '';
    /** Base WORK_DIR — used only for validation; per-tenant workDir is in TenantContext. */
    private baseWorkDir = '';

    constructor() {
        this.apiKey = GEMINI_API_KEY;
        this.model = resolveModel(GEMINI_MODEL_ENV ?? 'flash');
        const rawWorkDir = WORK_DIR || GEMINI_WORK_DIR;
        this.baseWorkDir = rawWorkDir ? resolve(rawWorkDir) : '';

        if (!this.apiKey) {
            console.log('[AgentRuntime] ❌ Disabled: GEMINI_API_KEY not set');
            return;
        }
        if (!this.baseWorkDir) {
            console.log('[AgentRuntime] ❌ Disabled: WORK_DIR (or GEMINI_WORK_DIR) not set');
            return;
        }

        this.enabled = true;
        console.log(`[AgentRuntime] ✅ Initialized. Model: ${this.model}`);
        console.log(`[AgentRuntime] 📂 BaseWorkDir: ${this.baseWorkDir}`);
    }

    private async buildPrompt(message: string, workDir: string, history?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

        // Inject NOW.md (Short-term memory / Workbench)
        try {
            const nowMdPath = join(workDir, 'memory', 'NOW.md');
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
        context?: ToolContext,
        modelOverride?: string,
    ): Promise<string | null> {
        if (!this.enabled) {
            console.warn(`[AgentRuntime] Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

        // Resolve per-tenant workDir and systemInstruction from context
        const workDir = context?.workDir || this.baseWorkDir;
        const systemInstruction = context?.systemInstruction || '';

        const prompt = await this.buildPrompt(message, workDir, history);
        const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }];

        try {
            const start = Date.now();
            const effectiveModel = modelOverride ? resolveModel(modelOverride) : this.model;
            console.log(`[AgentRuntime] → ${effectiveModel}: ${message.slice(0, 60).replace(/\n/g, ' ')}${imageInput ? ' [+image]' : ''}...`);
            const result = await agentLoop(
                this.apiKey,
                effectiveModel,
                systemInstruction,
                contents,
                workDir,
                toolRegistry,
                onChunk,
                imageInput,
                signal,
                context,
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
        context?: ToolContext,
        model?: string,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, undefined, signal, context, model);
    }

    /** Multimodal variant — same as chatWithContextStreaming but attaches an image. */
    async chatWithContextStreamingWithImage(
        message: string,
        conversationHistory: string,
        imageInput: ImageInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
        context?: ToolContext,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, imageInput, signal, context);
    }

    /** Same as WithImage but semantically for documents (PDF, audio, video via File API). */
    async chatWithContextStreamingWithFile(
        message: string,
        conversationHistory: string,
        fileInput: FileInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
        context?: ToolContext,
    ): Promise<string | null> {
        return this.runAgent(message, conversationHistory, onChunk, fileInput, signal, context);
    }

    async chatWithContext(message: string, conversationHistory: string, context?: ToolContext): Promise<string | null> {
        return this.runAgent(message, conversationHistory, undefined, undefined, undefined, context);
    }

    async chat(message: string, context?: ToolContext): Promise<string | null> {
        return this.runAgent(message, undefined, undefined, undefined, undefined, context);
    }

    /**
     * Async isolated task — same agentic loop, fresh context (no shared history).
     */
    async chatAsyncWithContext(message: string, context?: ToolContext): Promise<string | null> {
        return this.runAgent(message, undefined, undefined, undefined, undefined, context);
    }

    async runTool(toolName: string, args: string[], context?: ToolContext): Promise<string | null> {
        const prompt =
            `Please execute the tool **${toolName}**.\n\n` +
            `Arguments: ${args.join(' ')}\n\n` +
            `(Tool: ${toolName})`;
        return this.runAgent(prompt, undefined, undefined, undefined, undefined, context);
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
