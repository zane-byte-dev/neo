/**
 * src/llm/client.ts — Provider-agnostic LLM client.
 *
 * LLMClient wraps any LLMProvider and exposes the same high-level chat
 * methods used throughout the application.  The tool registry, system
 * instruction loading, and prompt construction live here so they are
 * shared across all providers.
 *
 * Backwards-compat alias: GeminiClient = LLMClient (Gemini provider default).
 */

import { join, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import { setupLogger } from '../utils/logger.js';
import { GEMINI_API_KEY, GEMINI_MODEL_ENV, WORK_DIR } from '../config.js';
import { loadOpenClawSkills, formatSkillsPrompt } from '../skills/openclaw-skills.js';
import { GeminiProvider, geminiGenerate, geminiUploadFile } from './providers/gemini/index.js';
import type { LLMProvider } from './provider.js';
import type {
    StreamCallback,
    ImageInput,
    FileInput,
    GeminiContent,
    Tool,
    ToolContext,
} from './types.js';

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
} from './types.js';

// Re-export standalone helpers for direct callers.
export { geminiGenerate, geminiUploadFile } from './providers/gemini/index.js';

setupLogger();

// ── Tool registry ─────────────────────────────────────────────────────────────

const toolRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    toolRegistry.set(tool.declaration.name, tool);
    console.log(`[AgentRuntime] 🔧 Tool registered: ${tool.declaration.name}`);
}

export function getToolRegistry(): Map<string, Tool> {
    return toolRegistry;
}

// ── System instruction helpers ────────────────────────────────────────────────

/**
 * Load system instruction from a config directory.
 * Reads AGENTS.md (required) + optional SOUL.md, TOOLS.md, XIFENG.md.
 * Falls back to legacy agent.md if AGENTS.md not found.
 */
export async function loadSystemInstruction(configDir: string, ...fallbackDirs: string[]): Promise<string> {
    const dirs = [configDir, ...fallbackDirs].filter(Boolean);

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
 * 2. Workspace skills ({workDir}/config/skills/)
 * 3. Global OpenClaw skills (~/.openclaw/workspace/skills/)
 */
export async function buildTenantSystemInstruction(workDir: string): Promise<string> {
    const configDir = join(workDir, 'config');
    const parts: string[] = [];

    const si = await loadSystemInstruction(configDir);
    if (si) parts.push(si);

    const workspaceSkills = await loadOpenClawSkills(join(configDir, 'skills'));
    if (workspaceSkills.length > 0) {
        parts.push(formatSkillsPrompt(workspaceSkills));
        console.log(`[AgentRuntime] 🧩 Workspace skills: ${workspaceSkills.length} — ${workspaceSkills.map(s => s.name).join(', ')}`);
    }

    const globalSkills = await loadOpenClawSkills();
    if (globalSkills.length > 0) {
        parts.push(formatSkillsPrompt(globalSkills));
        console.log(`[AgentRuntime] 🧩 OpenClaw skills: ${globalSkills.length} — ${globalSkills.map(s => s.name).join(', ')}`);
    }

    return parts.join('\n\n---\n\n');
}

// ── LLMClient ─────────────────────────────────────────────────────────────────

export class LLMClient {
    private enabled = false;
    private apiKey = '';
    private model = '';
    private provider: LLMProvider;

    constructor(provider?: LLMProvider) {
        this.provider = provider ?? new GeminiProvider();
        this.apiKey = GEMINI_API_KEY;
        this.model = this.provider.resolveModel(GEMINI_MODEL_ENV ?? 'flash');

        if (!this.apiKey) {
            console.log('[AgentRuntime] ❌ Disabled: GEMINI_API_KEY not set');
            return;
        }

        this.enabled = true;
        console.log(`[AgentRuntime] ✅ Initialized. Provider: ${this.provider.name}, Model: ${this.model}`);
    }

    private async buildPrompt(message: string, workDir: string, history?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

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
        context: ToolContext,
        history?: string,
        onChunk?: StreamCallback,
        imageInput?: ImageInput,
        signal?: AbortSignal,
        modelOverride?: string,
    ): Promise<string | null> {
        if (!this.enabled) {
            console.warn(`[AgentRuntime] Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

        const workDir = context?.workDir;
        const systemInstruction = context?.systemInstruction || '';

        const prompt = await this.buildPrompt(message, workDir, history);
        const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }];

        try {
            const start = Date.now();
            const effectiveModel = modelOverride ? this.provider.resolveModel(modelOverride) : this.model;
            const scope = context?.tenantKey ?? 'web';
            console.log(`[AgentRuntime|${scope}] → ${effectiveModel}: ${message.slice(0, 60).replace(/\n/g, ' ')}${imageInput ? ' [+image]' : ''}...`);

            const result = await this.provider.agentLoop({
                apiKey: this.apiKey,
                model: effectiveModel,
                systemInstruction,
                contents,
                workDir,
                toolRegistry,
                onChunk,
                imageInput,
                signal,
                context,
            });

            const elapsed = Date.now() - start;
            if (!result) {
                console.warn(`[AgentRuntime|${scope}] Empty result after ${elapsed}ms for: ${message.slice(0, 80).replace(/\n/g, ' ')}`);
            } else {
                console.log(`[AgentRuntime|${scope}] ✅ Done in ${elapsed}ms, response length=${result.length}`);
            }
            return result || null;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[AgentRuntime|${context?.tenantKey ?? 'web'}] Error: ${msg}`);
            return `🔥 Agent error: ${msg}`;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async chatWithContextStreaming(
        message: string,
        conversationHistory: string,
        context: ToolContext,
        onChunk: StreamCallback,
        signal?: AbortSignal,
        model?: string,
    ): Promise<string | null> {
        return this.runAgent(message, context, conversationHistory, onChunk, undefined, signal,model);
    }

    async chatWithContextStreamingWithImage(
        message: string,
        context: ToolContext,
        conversationHistory: string,
        imageInput: ImageInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
    ): Promise<string | null> {
        return this.runAgent(message, context, conversationHistory, onChunk, imageInput, signal);
    }

    async chatWithContextStreamingWithFile(
        message: string,
        context: ToolContext,
        conversationHistory: string,
        fileInput: FileInput,
        onChunk: StreamCallback,
        signal?: AbortSignal,
    ): Promise<string | null> {
        return this.runAgent(message, context, conversationHistory, onChunk, fileInput, signal);
    }

    async chat(message: string, context: ToolContext): Promise<string | null> {
        return this.runAgent(message, context);
    }

    async runTool(toolName: string, args: string[], context: ToolContext): Promise<string | null> {
        const prompt =
            `Please execute the tool **${toolName}**.\n\n` +
            `Arguments: ${args.join(' ')}\n\n` +
            `(Tool: ${toolName})`;
        return this.runAgent(prompt, context);
    }

    /** No-op: no subprocess to terminate. */
    close(): void {}

    /** Expose the underlying provider for advanced use. */
    getProvider(): LLMProvider {
        return this.provider;
    }
}

export function createLLMClient(provider?: LLMProvider): LLMClient {
    return new LLMClient(provider);
}
