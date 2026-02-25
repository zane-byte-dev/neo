import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GoogleGenerativeAI, GenerativeModel, Content } from '@google/generative-ai';

// Load environment variables
config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR; // Required working directory for loading personas/system prompts

// ==================== Persona Router ====================

/**
 * Persona 定义：关键词 → Persona 文件名（不含扩展名）
 */
const PERSONA_RULES: { keywords: string[]; file: string; name: string }[] = [
    {
        name: '🌋 作家 Writer',
        file: '作家',
        keywords: ['写文章', '沉淀', '系统化', '长文', '整理', '笔记', '总结', '输出'],
    },
    {
        name: '🎩 西风 West Wind',
        file: '西风',
        keywords: ['方向', '决策', '怎么看', '人性', '分析', '战略', '选择', '判断', '审视', '反思'],
    }
];

/**
 * 无触发词时的默认 Persona（fallback）
 * 设计选择：西风（West Wind）作为全能默认视角 ——
 * 日常聊天大多带有判断/分析色彩，且西风的 prompt 中有「优先使用中文」的明确指令。
 */
const DEFAULT_PERSONA = { file: '西风', name: '🎩 西风 West Wind (default)' };

/**
 * 根据消息内容检测应使用的 Persona
 * 无匹配时返回 DEFAULT_PERSONA（而非 null）
 */
function detectPersona(message: string): { file: string; name: string } {
    const lower = message.toLowerCase();
    for (const rule of PERSONA_RULES) {
        if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
            return { file: rule.file, name: rule.name };
        }
    }
    return DEFAULT_PERSONA;
}

import { sentinelToolDeclarations, SentinelToolExecutor } from './gemini-tools.js';

// ==================== GeminiClient (Direct SDK) ====================

export class GeminiClient {
    private enabled: boolean = false;
    private workDir?: string;
    private systemContext: string = '';
    private personasDir?: string;

    private genAI?: GoogleGenerativeAI;
    private cachedModels: Map<string, GenerativeModel> = new Map();
    private toolExecutor?: SentinelToolExecutor;

    constructor() {
        this.workDir = GEMINI_WORK_DIR;

        if (GEMINI_API_KEY && this.workDir) {
            this.enabled = true;
            this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            this.toolExecutor = new SentinelToolExecutor(this.workDir);
            console.log(`[Gemini SDK] ✅ Initialized with standard API key.`);
            console.log(`[Gemini SDK] 📂 Working directory: ${this.workDir}`);
            this.personasDir = join(this.workDir, 'system', 'persona');
            this.loadSystemContext();
        } else {
            console.log('[Gemini SDK] ❌ Disabled. Missing GEMINI_API_KEY or GEMINI_WORK_DIR in .env');
        }
    }

    /**
     * Load base system context from GEMINI.md
     */
    private loadSystemContext() {
        if (!this.workDir) return;

        const loc = join(this.workDir, 'system', 'GEMINI.md');
        if (existsSync(loc)) {
            try {
                this.systemContext = readFileSync(loc, 'utf-8');
                console.log(`[Gemini SDK] ✅ Loaded system context from: ${loc}`);
                return;
            } catch (err) {
                console.warn(`[Gemini SDK] ⚠️ Failed to read context from ${loc}: ${err}`);
            }
        }
        console.log('[Gemini SDK] ℹ️ No GEMINI.md context found. Working in naked mode.');
    }

    /**
     * Dynamically load a Persona's prompt file.
     * Returns empty string if not found.
     */
    private loadPersonaContext(file: string): string {
        if (!this.personasDir) return '';
        const loc = join(this.personasDir, `${file}.md`);
        if (!existsSync(loc)) {
            console.warn(`[Gemini SDK] ⚠️ Persona file not found: ${loc}`);
            return '';
        }
        try {
            return readFileSync(loc, 'utf-8');
        } catch (err) {
            console.warn(`[Gemini SDK] ⚠️ Failed to read persona ${file}: ${err}`);
            return '';
        }
    }

    /**
     * Get or create a generative model configured with the global system context
     * and the specific persona.
     */
    private getModelForPersona(persona: { file: string; name: string }): GenerativeModel {
        if (!this.genAI) throw new Error('GenerativeAI not initialized');

        // Cache mapping key
        const cacheKey = persona.file;
        if (this.cachedModels.has(cacheKey)) {
            return this.cachedModels.get(cacheKey)!;
        }

        const personaContent = this.loadPersonaContext(persona.file);

        // Combine Base Context (GEMINI.md) + Persona Details
        let finalInstruction = this.systemContext ? `[Master System Alignment]\n${this.systemContext}\n\n` : '';
        if (personaContent) {
            finalInstruction += `[Your Persona Profile: ${persona.name}]\n${personaContent}\n\n`;
        }

        // Hardcoded critical behaviors
        finalInstruction += `[Critical System Rules]\n- You MUST respond strictly in CHINESE (简体中文).\n- NEVER output repetitive reasoning logs or think out loud formatting.\n- Be direct, concise, and professional without generic AI phrases.\n- Current Time Context: ${new Date().toLocaleString('zh-CN')}`;

        const model = this.genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: finalInstruction,
            tools: [{ functionDeclarations: sentinelToolDeclarations }]
        });

        this.cachedModels.set(cacheKey, model);
        console.log(`[Gemini SDK] 🎭 Generated model instance for persona: ${persona.name}`);
        return model;
    }

    /**
     * Call SDK to generate a response.
     */
    async generateResponse(prompt: string, persona?: { file: string; name: string } | null, history?: string): Promise<string | null> {
        if (!this.enabled || !this.genAI) {
            return null;
        }

        try {
            const activePersona = persona || DEFAULT_PERSONA;
            const model = this.getModelForPersona(activePersona);

            // Note: Since our current ConversationHistory string block is just an aggregate string, 
            // for migration simplicity we merge it into the user prompt. 
            // In a better multi-turn, you would parse history into Role: user/model arrays.
            let finalPrompt = prompt;
            if (history && history.trim()) {
                finalPrompt = `[Previous Conversation History]\n${history}\n\n[New Message]\n${prompt}`;
            }

            console.log(`[Gemini SDK] Sending request to ${GEMINI_MODEL} (persona: ${activePersona.name})`);
            const startTime = Date.now();

            // We use startChat so we can easily append tool responses back
            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: finalPrompt }] }
                ]
            });

            // Initial generic send (we just pass an empty string because the payload is in history)
            let result = await chat.sendMessage("");

            // Recursively evaluate if the model wants to call tools
            let maxTurns = 5;
            let currentResponseText = "";
            let functionCallReports: string[] = [];

            while (maxTurns > 0) {
                const call = result.response.functionCalls() && result.response.functionCalls()![0];

                if (call) {
                    console.log(`[Gemini SDK] 🛠️  Model requested tool call: ${call.name}`);

                    // Execute the local tool
                    const apiResponse = await this.toolExecutor?.executeToolCall(call.name, call.args);

                    if (apiResponse && apiResponse.success) {
                        functionCallReports.push(`✅ 执行动作: [${call.name}] 成功。`);
                    } else if (apiResponse && apiResponse.error) {
                        functionCallReports.push(`❌ 执行动作: [${call.name}] 失败 (${apiResponse.error})。`);
                    }

                    // Send the tool result back to the model
                    result = await chat.sendMessage([{
                        functionResponse: {
                            name: call.name,
                            response: apiResponse
                        }
                    }]);

                } else {
                    // No more function calls, extract text
                    currentResponseText = result.response.text();
                    break;
                }
                maxTurns--;
            }

            const ms = Date.now() - startTime;
            console.log(`[Gemini SDK] ✅ Received final response in ${ms}ms`);

            // Combine any backend reports with the final text
            if (functionCallReports.length > 0) {
                return `> _*系统通知*_\n> ${functionCallReports.join('\n> ')}\n\n${currentResponseText}`;
            }

            return currentResponseText;
        } catch (error) {
            console.error(`[Gemini SDK Error]`, error);
            if (error instanceof Error) {
                return `🔥 System Error (SDK): ${error.message}`;
            }
            return '🔥 Unknown SDK error occurred';
        }
    }

    /**
     * Chat with conversation context (legacy wrapper support)
     */
    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        const persona = detectPersona(message);
        return this.generateResponse(message, persona, conversationHistory);
    }

    /**
     * Simple chat (legacy wrapper support)
     */
    async chat(message: string): Promise<string | null> {
        const persona = detectPersona(message);
        return this.generateResponse(message, persona);
    }

    /**
     * Check if the client is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
    /**
     * Test the Gemini SDK connection
     */
    async testConnection(): Promise<boolean> {
        if (!this.enabled) {
            console.log('[Gemini SDK] ❌ Client not configured');
            return false;
        }

        console.log('[Gemini SDK] 🧪 Testing SDK connection...');
        const response = await this.generateResponse(
            "Hi! Please respond with 'OK' to confirm."
        );

        if (response && !response.startsWith('⚠️') && !response.startsWith('🔥')) {
            console.log('[Gemini SDK] ✅ SDK test successful');
            console.log(`[Gemini SDK] Response preview: ${response.substring(0, 100)}...`);
            return true;
        } else {
            console.log('[Gemini SDK] ❌ SDK test failed');
            if (response) {
                console.log(`[Gemini SDK] Error: ${response}`);
            }
            return false;
        }
    }
}

/**
 * Convenience function to create a Gemini client
 */
export function createGeminiClient(): GeminiClient {
    return new GeminiClient();
}

// Test script when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Testing Gemini SDK Client...\n');

    const client = createGeminiClient();

    if (client.isEnabled()) {
        const startTime = Date.now();
        console.log('[Gemini SDK] 🧪 Testing Tool Calling...');
        client.generateResponse("帮我在今天的流水日记里记一笔：刚刚把底层重构成SDK+FunctionCalling了，很快！").then(res => {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`\n[Agent Response]\n${res}\n\n⏱️  Response time: ${elapsed.toFixed(2)}s`);
        });
    }
}
