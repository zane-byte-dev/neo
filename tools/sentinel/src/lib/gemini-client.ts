import { config } from 'dotenv';
import { execa } from 'execa';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
config();

const GEMINI_CLI_PATH = process.env.GEMINI_CLI_PATH || 'gemini';
const GEMINI_TIMEOUT = parseInt(process.env.GEMINI_TIMEOUT || '180', 10) * 1000; // Convert to ms
const GEMINI_WORK_DIR = process.env.GEMINI_WORK_DIR; // Optional working directory

export class GeminiClient {
    private enabled: boolean = false;
    private cliPath: string;
    private timeout: number;
    private workDir?: string;
    private systemContext: string = '';

    constructor() {
        this.cliPath = GEMINI_CLI_PATH;
        this.timeout = GEMINI_TIMEOUT;
        this.workDir = GEMINI_WORK_DIR;

        if (this.checkCli()) {
            this.enabled = true;
            console.log(`[Gemini] ✅ Using CLI at: ${this.cliPath}`);
            if (this.workDir) {
                console.log(`[Gemini] 📂 Working directory: ${this.workDir}`);
                this.loadSystemContext();
            }
            console.log('[Gemini] ⚠️  CLI mode can be slow (~17s per query)');
        } else {
            console.log('[Gemini] ❌ CLI not available');
            console.log('[Gemini] Please install Gemini CLI or check GEMINI_CLI_PATH');
        }
    }

    /**
     * Load system context from GEMINI.md
     */
    private loadSystemContext() {
        if (!this.workDir) return;

        // Try to find GEMINI.md in likely locations
        const locations = [
            join(this.workDir, '99_系统', 'GEMINI.md'),
            join(this.workDir, 'GEMINI.md')
        ];

        for (const loc of locations) {
            if (existsSync(loc)) {
                try {
                    const content = readFileSync(loc, 'utf-8');
                    this.systemContext = content;
                    console.log(`[Gemini] ✅ Loaded system context from: ${loc}`);
                    return;
                } catch (err) {
                    console.warn(`[Gemini] ⚠️ Failed to read context from ${loc}: ${err}`);
                }
            }
        }

        console.log('[Gemini] ℹ️ No GEMINI.md context found. Using default.');
    }

    /**
     * Check if Gemini CLI is available
     */
    private checkCli(): boolean {
        try {
            console.log(`[Gemini] Checking CLI at: ${this.cliPath}`);
            const result = spawnSync(this.cliPath, ['--help'], {
                timeout: 5000,
                encoding: 'utf-8',
            });
            console.log(`[Gemini] CLI check result - status: ${result.status}, error: ${result.error}`);
            if (result.error) {
                console.log(`[Gemini] CLI error details: ${result.error.message}`);
                return false;
            }
            return result.status === 0;
        } catch (error) {
            console.log(`[Gemini] CLI check exception: ${error}`);
            return false;
        }
    }

    /**
     * Call Gemini CLI to generate a response
     */
    async generateResponse(prompt: string): Promise<string | null> {
        if (!this.enabled) {
            return null;
        }

        try {
            // Inject current date and time to prevent model confusion
            const today = new Date().toISOString().split('T')[0];
            const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });

            // Construct the full prompt with context
            let fullPrompt = '';

            // 1. Inject System Context (GEMINI.md) if available
            if (this.systemContext) {
                fullPrompt += `[System Context]\n${this.systemContext}\n\n`;
            }

            // 2. Add current context lines
            fullPrompt += `[Current Time]\nToday is ${today} (${weekday}).\n\n`;

            // 3. Add User Query
            fullPrompt += `[User Query]\n${prompt}\n\n`;

            // 4. Add Output Instructions
            fullPrompt += `[Instructions]\n(Important: Please respond in CHINESE (中文). Please EXECUTE the necessary tools and PRINT the final result/answer directly.)`;

            // Build command: gemini run "prompt" --yolo --output-format text
            const args = ['run', fullPrompt, '-y', '--output-format', 'text'];

            console.log(`[Gemini] Executing: ${this.cliPath} run ... (prompt length: ${fullPrompt.length})`);
            if (this.workDir) {
                // console.log(`[Gemini] Working directory: ${this.workDir}`);
            }

            const { stdout, stderr, exitCode } = await execa(this.cliPath, args, {
                timeout: this.timeout,
                reject: false, // Don't throw on non-zero exit
                cwd: this.workDir, // Set working directory if specified
            });

            // Clean output by removing noise
            const cleanOutput = this.cleanOutput(stdout);

            if (!cleanOutput) {
                if (exitCode !== 0) {
                    return `⚠️ CLI Error: ${stderr.trim()}`;
                }
                return '⚠️ InkBrain 似乎执行了操作，但没有返回文本结果。';
            }

            return cleanOutput;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('timed out')) {
                    return `⏱️ Error: Thinking timed out (${this.timeout / 1000}s).`;
                }
                return `🔥 System Error: ${error.message}`;
            }
            return '🔥 Unknown error occurred';
        }
    }

    /**
     * Clean CLI output by removing noise
     */
    private cleanOutput(rawOutput: string): string {
        const noiseMarkers = [
            '[ERROR]',
            '[INFO]',
            'Loading extension',
            'YOLO mode',
            'Loaded cached',
            'Server \t',
            'Hook registry',
            // 'I will check' - keep thinking process for transparency
        ];

        const lines = rawOutput.split('\n');
        const cleanLines: string[] = [];

        for (const line of lines) {
            // Skip lines containing noise markers
            if (noiseMarkers.some((marker) => line.includes(marker))) {
                continue;
            }

            // Handle empty lines (preserve paragraph structure)
            if (!line.trim()) {
                // Avoid consecutive empty lines
                if (cleanLines.length > 0 && cleanLines[cleanLines.length - 1] !== '') {
                    cleanLines.push(line);
                }
                continue;
            }

            cleanLines.push(line);
        }

        return cleanLines.join('\n').trim();
    }

    /**
     * Chat interface (simplified)
     */
    async chat(message: string, systemInstruction?: string): Promise<string | null> {
        // The systemContext is now handled internally in generateResponse
        // We can ignore systemInstruction or append it if needed, 
        // but for now let's just use the message as the prompt source.
        return this.generateResponse(message);
    }

    /**
     * Chat with conversation context
     */
    async chatWithContext(message: string, conversationHistory: string): Promise<string | null> {
        // Inject conversation history before the user query
        let promptWithContext = message;

        if (conversationHistory && conversationHistory.trim()) {
            promptWithContext = `[Previous Conversation]\n${conversationHistory}\n\n[New Question]\n${message}`;
        }

        return this.generateResponse(promptWithContext);
    }

    /**
     * Test the Gemini CLI connection
     */
    async testConnection(): Promise<boolean> {
        if (!this.enabled) {
            console.log('[Gemini] ❌ Client not configured');
            return false;
        }

        console.log('[Gemini] 🧪 Testing CLI connection...');
        const response = await this.generateResponse(
            "Hi! Please respond with 'OK' to confirm."
        );

        if (response && !response.startsWith('⚠️') && !response.startsWith('🔥')) {
            console.log('[Gemini] ✅ CLI test successful');
            console.log(`[Gemini] Response preview: ${response.substring(0, 100)}...`);
            return true;
        } else {
            console.log('[Gemini] ❌ CLI test failed');
            if (response) {
                console.log(`[Gemini] Error: ${response}`);
            }
            return false;
        }
    }

    /**
     * Check if the client is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
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
    console.log('Testing Gemini Client...\n');

    const client = createGeminiClient();

    if (client.isEnabled()) {
        const startTime = Date.now();
        await client.testConnection();
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n⏱️  Response time: ${elapsed.toFixed(2)}s`);
    } else {
        console.log('\n📝 Setup Instructions:');
        console.log('\nCLI Mode:');
        console.log('  1. Install Gemini CLI');
        console.log('  2. Add to .env: GEMINI_CLI_PATH=/path/to/gemini');
        console.log('  3. Optional: GEMINI_TIMEOUT=180');
    }
}
