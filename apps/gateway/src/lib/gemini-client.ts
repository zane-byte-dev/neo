import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AcpClient } from './acp-client.js';

// Load environment variables relative to the library regardless of execution directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env') });

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR; // Required working directory for context

// ==================== GeminiClient (ACP CLI Thin Wrapper) ====================

export class GeminiClient {
    private enabled: boolean = false;
    private workDir?: string;
    private acpClient?: AcpClient;
    private initializationPromise?: Promise<void>;

    constructor() {
        this.workDir = GEMINI_WORK_DIR;

        if (this.workDir) {
            this.enabled = true;
            console.log(`[Gemini SDK] ✅ Initialized natively via ACP CLI.`);
            console.log(`[Gemini SDK] 📂 Working directory: ${this.workDir}`);

            this.acpClient = new AcpClient(this.workDir, GEMINI_MODEL);
            this.initializationPromise = this.acpClient.start();
        } else {
            console.log('[Gemini SDK] ❌ Disabled. Missing GEMINI_WORK_DIR in .env');
        }
    }

    /**
     * Call SDK to generate a response via ACP Client.
     * Delegates pure context generation to the underlying CLI instance logic.
     */
    async generateResponse(prompt: string, history?: string): Promise<string | null> {
        if (!this.enabled || !this.acpClient) return null;

        await this.initializationPromise; // Ensure ACP is connected

        try {
            // Optional: You can prepend system guards here if you want to enforce language or style 
            // without reading the whole GEMINI.md manually.
            let finalPrompt = `[System Override]\n- You MUST respond strictly in CHINESE (简体中文) unless specified.\n- Be direct, concise, and professional without generic AI phrases.\n- Current Time Context: ${new Date().toLocaleString('zh-CN')}\n\n`;

            if (history && history.trim()) {
                finalPrompt += `[Previous Conversation History]\n${history}\n\n`;
            }
            finalPrompt += `[New Message]\n${prompt}`;

            console.log(`[Gemini SDK] Sending request via ACP to ${GEMINI_MODEL}`);
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
     * Chat with conversation context
     */
    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        return this.generateResponse(message, conversationHistory);
    }

    /**
     * Simple chat 
     */
    async chat(message: string): Promise<string | null> {
        return this.generateResponse(message);
    }

    /**
     * Ask the underlying agent to explicitly execute a specific skill.
     * Does not manually mount the skill file, relies on the agent's filesystem capabilities or CLI context.
     */
    async runSkill(skillName: string, args: string[]): Promise<string | null> {
        if (!this.enabled || !this.acpClient) return null;

        // Simply ask the native CLI to run the skill by name
        const prompt = `Please execute the skill **${skillName}**.\n\nAdditional user input/arguments: ${args.join(' ')}\n\n(Tip: Look for system/skill/${skillName}.md if you need instructions.)`;

        console.log(`[Gemini SDK] 🎯 Triggering skill via ACP: ${skillName}`);
        return this.generateResponse(prompt);
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
        const response = await this.generateResponse("Hi! Please respond with 'OK' to confirm.");

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
        client.generateResponse("用一句话形容现在的通信机制。").then(res => {
            console.log('\n💬 [Response]:\n' + res);
            client.close();
        });
    }
}
