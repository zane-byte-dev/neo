/**
 * src/llm/client.ts — LLM client powered by Vercel AI SDK.
 *
 * Wraps AI SDK's streamText / generateText and exposes the same high-level
 * chat methods used throughout the application.  The tool registry, system
 * instruction loading, and prompt construction live here.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { streamText, generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { setupLogger } from '../utils/logger.js';
import { GEMINI_API_KEY, GEMINI_MODEL_ENV, MAX_TOOL_ITERATIONS, MAX_SUBAGENT_STEPS, MODEL_ALIASES } from '../config.js';
import { buildAiTools } from './ai-tools.js';
import type {
    StreamCallback,
    Tool,
    ToolContext,
} from './types.js';

export type {
    StreamChunk,
    StreamCallback,
    FunctionDeclaration,
    ToolMeta,
    Tool,
    ToolContext,
} from './types.js';

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

// ── Model helpers ─────────────────────────────────────────────────────────────

/** Resolve a short alias (e.g. "flash") to the canonical model ID. */
export function resolveModel(alias: string): string {
    return MODEL_ALIASES[alias] ?? alias;
}

/** Create an AI SDK LanguageModel for a given model id. */
function createModel(modelId: string): LanguageModel {
    const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
    return google(modelId);
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

    // Try config/ first, fall back to workspace root (where AGENTS.md etc. often live)
    const si = await loadSystemInstruction(configDir, workDir);
    if (si) parts.push(si);

    // Inject USER.md into system prompt so the agent knows the user
    try {
        const userMd = await fs.readFile(join(workDir, 'USER.md'), 'utf8');
        if (userMd.trim()) {
            parts.push(`[用户档案]\n${userMd.trim()}`);
        }
    } catch { /* USER.md not found — skip */ }

    return parts.join('\n\n---\n\n');
}

// ── LLMClient ─────────────────────────────────────────────────────────────────

export class LLMClient {
    private enabled = false;
    private modelId = '';

    constructor() {
        if (!GEMINI_API_KEY) {
            console.log('[AgentRuntime] ❌ Disabled: GEMINI_API_KEY not set');
            return;
        }

        this.modelId = resolveModel(GEMINI_MODEL_ENV ?? 'flash');
        this.enabled = true;
        console.log(`[AgentRuntime] ✅ Initialized (AI SDK). Model: ${this.modelId}`);
    }

    private async buildPrompt(message: string, workDir: string, history?: string): Promise<string> {
        const now = new Date().toLocaleString('zh-CN');
        let prompt = `[Runtime Context]\n- Current Time: ${now}\n`;

        try {
            const nowMdPath = join(workDir, 'memory', 'NOW.md');
            const nowMd = await fs.readFile(nowMdPath, 'utf8');
            if (nowMd.trim()) {
                prompt += `\n[User Background & Long-term Goals]\n` +
                    `（以下是用户的长期目标与近况背景，仅供参考，不是本次对话的任务指令）\n` +
                    `${nowMd.trim()}\n`;
            }
        } catch { /* NOW.md not found */ }

        if (history?.trim()) {
            prompt += `\n[Previous Conversation History]\n${history}\n`;
        }
        prompt += `\n[New Message]\n${message}`;
        return prompt;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async chatWithContextStreaming(
        message: string,
        conversationHistory: string | Array<{ role: string; content: string }>,
        context: ToolContext,
        onChunk: StreamCallback,
        signal?: AbortSignal,
        modelOverride?: string,
        images?: string[],
    ): Promise<string | null> {
        if (!this.enabled) {
            console.warn(`[AgentRuntime] Skipped (disabled): ${message.slice(0, 60).replace(/\n/g, ' ')}`);
            return null;
        }

        const workDir = context.workDir;
        const systemInstruction = context.systemInstruction || '';
        const effectiveModel = modelOverride ? resolveModel(modelOverride) : this.modelId;
        const model = createModel(effectiveModel);
        const tools = buildAiTools(toolRegistry, workDir, context);

        // Build AI SDK messages array when structured history is available or images are attached
        const useMessages = (Array.isArray(conversationHistory) && conversationHistory.length > 0) || (images?.length ?? 0) > 0;

        let prompt: string | undefined;
        const messages: ModelMessage[] = [];

        if (useMessages) {
            // Use structured messages — build prompt without embedded history
            const runtimePrompt = await this.buildPrompt(message, workDir);
            for (const msg of conversationHistory as Array<{ role: string; content: string }>) {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.content,
                });
            }
            // Build multimodal content when images are attached
            if (images?.length) {
                const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> = [
                    { type: 'text', text: runtimePrompt },
                ];
                for (const dataUrl of images) {
                    parts.push({ type: 'image', image: new URL(dataUrl) });
                }
                messages.push({ role: 'user', content: parts });
            } else {
                messages.push({ role: 'user', content: runtimePrompt });
            }
        } else {
            // Fallback: embed history as a string in the prompt
            const historyStr = typeof conversationHistory === 'string' ? conversationHistory : '';
            prompt = await this.buildPrompt(message, workDir, historyStr || undefined);
        }

        try {
            const baseOpts = {
                model,
                system: systemInstruction,
                tools,
                stopWhen: stepCountIs(MAX_TOOL_ITERATIONS),
                abortSignal: signal,
                temperature: 0.7,
            };

            const result = useMessages
                ? streamText({ ...baseOpts, messages })
                : streamText({ ...baseOpts, prompt: prompt! });

            let fullText = '';

            for await (const part of result.fullStream) {
                switch (part.type) {
                    case 'reasoning-delta':
                        onChunk({ type: 'thought', text: part.text });
                        break;
                    case 'tool-call':
                        onChunk({ type: 'tool_call', toolName: part.toolName, args: part.input as Record<string, unknown> });
                        break;
                    case 'tool-result': {
                        const r = part.output;
                        const s = typeof r === 'string' ? r : JSON.stringify(r);
                        onChunk({ type: 'tool_result', toolName: part.toolName, result: s.slice(0, 500) });
                        break;
                    }
                    case 'text-delta':
                        onChunk({ type: 'text', text: part.text });
                        fullText += part.text;
                        break;
                    case 'error':
                        console.error('[AgentRuntime] Stream error:', part.error);
                        break;
                }
            }

            return fullText || null;
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            const msg = err instanceof Error ? err.message : String(err);
            return `🔥 Agent error: ${msg}`;
        }
    }

    /** Non-streaming generation with tool support, used by subagent. */
    async generateWithTools(
        prompt: string,
        toolSet: import('ai').ToolSet,
        options?: { model?: string; system?: string; temperature?: number; maxSteps?: number },
    ): Promise<string | null> {
        if (!this.enabled) return null;
        const modelId = options?.model ? resolveModel(options.model) : this.modelId;
        const steps = options?.maxSteps ?? MAX_SUBAGENT_STEPS;
        try {
            const { text } = await generateText({
                model: createModel(modelId),
                prompt,
                system: options?.system,
                temperature: options?.temperature ?? 0.7,
                tools: toolSet,
                stopWhen: stepCountIs(steps),
            });
            return text || null;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return `🔥 Subagent error: ${msg}`;
        }
    }

    /** Simple text generation without streaming or tools. */
    async generate(
        prompt: string,
        options?: { model?: string; system?: string; temperature?: number },
    ): Promise<string | null> {
        if (!this.enabled) return null;
        const modelId = options?.model ? resolveModel(options.model) : this.modelId;
        try {
            const { text } = await generateText({
                model: createModel(modelId),
                prompt,
                system: options?.system,
                temperature: options?.temperature,
            });
            return text || null;
        } catch {
            return null;
        }
    }

    /** No-op: no subprocess to terminate. */
    close(): void {}
}
