import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AcpClient } from './acp-client.js';

// Load environment variables relative to the library regardless of execution directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR; // Required working directory for loading personas/system prompts

// ==================== Persona Router Data ====================

export interface PersonaRule {
    keywords: string[];
    file: string;
    name: string;
}

/**
 * 无触发词时的默认 Persona（fallback）
 * 设计选择：西风（West Wind）作为全能默认视角 ——
 * 日常聊天大多带有判断/分析色彩，且西风的 prompt 中有「优先使用中文」的明确指令。
 */
const DEFAULT_PERSONA = { file: '西风', name: '🎩 西风 West Wind (default)' };


// ==================== GeminiClient (ACP CLI Wrapper) ====================

export class GeminiClient {
    private enabled: boolean = false;
    private workDir?: string;
    private systemContext: string = '';
    private personasDir?: string;
    private dynamicPersonaRules: PersonaRule[] = [];

    private acpClient?: AcpClient;
    private initializationPromise?: Promise<void>;

    constructor() {
        this.workDir = GEMINI_WORK_DIR;

        if (this.workDir) {
            this.enabled = true;
            console.log(`[Gemini SDK] ✅ Initialized natively via ACP CLI.`);
            console.log(`[Gemini SDK] 📂 Working directory: ${this.workDir}`);
            this.personasDir = join(this.workDir, 'system', 'persona');
            this.acpClient = new AcpClient(this.workDir, GEMINI_MODEL);
            this.initializationPromise = this.acpClient.start();
            this.loadSystemContext();
        } else {
            console.log('[Gemini SDK] ❌ Disabled. Missing GEMINI_WORK_DIR in .env');
        }
    }

    /**
     * Load base system context from GEMINI.md and extract persona keywords dynamically
     */
    private loadSystemContext() {
        if (!this.workDir) return;

        const loc = join(this.workDir, 'system', 'GEMINI.md');
        if (existsSync(loc)) {
            try {
                this.systemContext = readFileSync(loc, 'utf-8');
                console.log(`[Gemini SDK] ✅ Loaded system context from: ${loc}`);
                this.parsePersonaRules(this.systemContext);
                return;
            } catch (err) {
                console.warn(`[Gemini SDK] ⚠️ Failed to read context from ${loc}: ${err}`);
            }
        }
        console.log('[Gemini SDK] ℹ️ No GEMINI.md context found. Working in naked mode.');
    }

    /**
     * Parse systemContext to dynamically extract routing rules.
     * Looks for markdown patterns like:
     * ### 2. 🎩 西风（决策/审计） - [[system/persona/西风.md]]
     * *   **关键词**：方向、决策、怎么看、审计、分析。
     */
    private parsePersonaRules(text: string) {
        this.dynamicPersonaRules = [];
        const blocks = text.split('### ');

        for (const block of blocks) {
            // Check if this block defines a persona link
            const fileMatch = block.match(/\[\[system\/persona\/(.+?)\.md\]\]/);
            if (!fileMatch) continue;

            const file = fileMatch[1];

            // Extract display name from the title line
            const firstLine = block.split('\n')[0];
            let name = file;
            const nameMatch = firstLine.match(/\d+\.\s+([^（(]+)/);
            if (nameMatch) {
                name = nameMatch[1].trim();
            }

            // Extract keywords
            const keywordMatch = block.match(/\*\*关键词\*\*[:：]\s*(.+)/);
            let keywords: string[] = [];
            if (keywordMatch) {
                // remove trailing punctuation, then split by common separators
                const raw = keywordMatch[1].replace(/[。.\s]+$/, '');
                keywords = raw.split(/[,，、]+/).map(k => k.trim()).filter(Boolean);
            }

            if (keywords.length > 0) {
                this.dynamicPersonaRules.push({ name, file, keywords });
            }
        }

        console.log(`[Gemini SDK] 🎭 Dynamically discovered ${this.dynamicPersonaRules.length} personas from GEMINI.md`);
        this.dynamicPersonaRules.forEach(r => console.log(`   - ${r.name}: [${r.keywords.join(', ')}]`));
    }

    /**
     * 根据消息内容检测应使用的 Persona (从动态词库中)
     */
    public detectPersona(message: string): { file: string; name: string } {
        const lower = message.toLowerCase();
        for (const rule of this.dynamicPersonaRules) {
            if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
                return { file: rule.file, name: rule.name };
            }
        }
        return DEFAULT_PERSONA;
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
     * Call SDK to generate a response via ACP Client.
     */
    async generateResponse(prompt: string, persona?: { file: string; name: string } | null, history?: string): Promise<string | null> {
        if (!this.enabled || !this.acpClient) return null;

        await this.initializationPromise; // Ensure ACP is connected

        try {
            const activePersona = persona || DEFAULT_PERSONA;
            const personaContent = this.loadPersonaContext(activePersona.file);

            let finalInstruction = this.systemContext ? `[Master System Alignment]\n${this.systemContext}\n\n` : '';
            if (personaContent) {
                finalInstruction += `[Your Persona Profile: ${activePersona.name}]\n${personaContent}\n\n`;
            }
            finalInstruction += `[Critical System Rules]\n- You MUST respond strictly in CHINESE (简体中文).\n- NEVER output repetitive reasoning logs or think out loud formatting.\n- Be direct, concise, and professional without generic AI phrases.\n- Current Time Context: ${new Date().toLocaleString('zh-CN')}\n\n`;

            let finalPrompt = `${finalInstruction}`;
            if (history && history.trim()) {
                finalPrompt += `[Previous Conversation History]\n${history}\n\n`;
            }
            finalPrompt += `[New Message]\n${prompt}`;

            console.log(`[Gemini SDK] Sending request via ACP to ${GEMINI_MODEL} (persona: ${activePersona.name})`);
            const startTime = Date.now();

            const currentResponseText = await this.acpClient.prompt(finalPrompt);

            const ms = Date.now() - startTime;
            console.log(`[Gemini SDK] ✅ Received final response via ACP in ${ms}ms`);

            return currentResponseText;
        } catch (error) {
            console.error(`[Gemini SDK Error]`, error);
            if (error instanceof Error) {
                return `🔥 System Error (ACP): ${error.message}`;
            }
            return '🔥 Unknown ACP SDK error occurred';
        }
    }

    /**
     * Chat with conversation context (legacy wrapper support)
     */
    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        const persona = this.detectPersona(message);
        return this.generateResponse(message, persona, conversationHistory);
    }

    /**
     * Simple chat (legacy wrapper support)
     */
    async chat(message: string): Promise<string | null> {
        const persona = this.detectPersona(message);
        return this.generateResponse(message, persona);
    }

    /**
     * Run a specific skill defined in system/skill/*.md
     */
    async runSkill(skillName: string, args: string[]): Promise<string | null> {
        if (!this.enabled || !this.acpClient) return null;

        await this.initializationPromise; // Ensure ACP is connected

        const skillPath = join(this.workDir || '', 'system', 'skill', `${skillName}.md`);
        if (!existsSync(skillPath)) {
            console.error(`❌ 技能文件未找到: ${skillPath}\n请检查 ${skillName} 是否存在于 system/skill/ 目录下。`);
            return null;
        }

        const skillContent = readFileSync(skillPath, 'utf-8');

        let finalInstruction = this.systemContext ? `[Master System Alignment]\n${this.systemContext}\n\n` : '';
        finalInstruction += `[Skill Profile: ${skillName}]\nYou are an autonomous agent executing this specific skill. Read the skill instructions below carefully and strictly follow the execution steps.\n${skillContent}\n\n`;
        finalInstruction += `[Critical System Rules]\n- You MUST respond strictly in CHINESE (简体中文).\n- NEVER output repetitive reasoning logs or think out loud formatting.\n- Be direct, concise, and professional without generic AI phrases.\n- Current Time Context: ${new Date().toLocaleString('zh-CN')}\n\n`;

        const prompt = `${finalInstruction}Please execute the skill **${skillName}**.\n\nAdditional user input/arguments: ${args.join(' ')}`;

        console.log(`[Gemini SDK] 🎯 Executing skill via ACP: ${skillName}`);
        const startTime = Date.now();

        try {
            const currentResponseText = await this.acpClient.prompt(prompt);

            const ms = Date.now() - startTime;
            console.log(`[Gemini SDK] ✅ Completed skill execution via ACP in ${ms}ms`);

            return currentResponseText;
        } catch (error) {
            console.error(`[Gemini SDK Error in runSkill]`, error);
            if (error instanceof Error) {
                return `🔥 System Error (Skill): ${error.message}`;
            }
            return '🔥 Unknown ACP error occurred finding skill.';
        }
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

        console.log('[Gemini SDK] 🧪 Testing ACP connection...');
        const response = await this.generateResponse(
            "Hi! Please respond with 'OK' to confirm."
        );

        if (response && !response.startsWith('⚠️') && !response.startsWith('🔥')) {
            console.log('[Gemini SDK] ✅ ACP SDK test successful');
            console.log(`[Gemini SDK] Response preview: ${response.substring(0, 100)}...`);
            return true;
        } else {
            console.log('[Gemini SDK] ❌ ACP SDK test failed');
            if (response) {
                console.log(`[Gemini SDK] Error: ${response}`);
            }
            return false;
        }
    }

    /**
     * Terminate the ACP underlying process cleanly
     */
    close(): void {
        this.acpClient?.stop();
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
    console.log('Testing Gemini ACP SDK Client...\n');

    const client = createGeminiClient();

    if (client.isEnabled()) {
        console.log('[Gemini SDK] 🧪 Testing Chatting...');
        client.generateResponse("帮我在今天的流水日记里记一笔：刚刚把底层重构成ACP了，很快！").then(res => {
            console.log('\n💬 [Response]:\n' + res);
            client.close();
        });
    }
}
